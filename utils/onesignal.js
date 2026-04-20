const axios = require('axios');

/**
 * OneSignal Utility for sending push notifications.
 * Uses the OneSignal REST API.
 */

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

/**
 * Send a push notification to specific users based on their external_id (user_id).
 * @param {Array|String} externalIds - Single User ID or Array of User IDs.
 * @param {String} title - Notification title.
 * @param {String} message - Notification body.
 * @param {Object} data - Additional data payload.
 */
const sendPushNotification = async (externalIds, title, message, data = {}) => {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
        console.warn('⚠️ OneSignal credentials missing. Push notification skipped.');
        return;
    }

    const ids = Array.isArray(externalIds) ? externalIds.map(id => id.toString()) : [externalIds.toString()];
    
    // Normalize credentials
    const apiKey = ONESIGNAL_REST_API_KEY.trim();
    const appId = ONESIGNAL_APP_ID.trim();

    // Determine primary header (os_v2 keys often prefer 'Key' prefix)
    const isV2 = apiKey.startsWith('os_v2_');
    const primaryAuthHeader = isV2 ? `Key ${apiKey}` : `Basic ${apiKey}`;
    const secondaryAuthHeader = isV2 ? `Basic ${apiKey}` : `Key ${apiKey}`;

    const sendRequest = async (authHeader) => {
        return axios.post('https://onesignal.com/api/v1/notifications', {
            app_id: appId,
            include_external_user_ids: ids,
            headings: { en: title },
            contents: { en: message },
            data: data
        }, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': authHeader
            }
        });
    };

    try {
        const response = await sendRequest(primaryAuthHeader);
        console.log('✅ OneSignal Notification Sent:', response.data);
        return response.data;
    } catch (error) {
        const status = error.response ? error.response.status : 'Unknown';
        const errorData = error.response ? error.response.data : error.message;

        // Try secondary header if primary failed with Auth error
        if (status === 401 || status === 403) {
            console.log(`🔄 OneSignal: Primary auth failed (${status}). Retrying with secondary header...`);
            try {
                const retryResponse = await sendRequest(secondaryAuthHeader);
                console.log('✅ OneSignal Notification Sent (via Secondary Header):', retryResponse.data);
                return retryResponse.data;
            } catch (retryError) {
                const retryStatus = retryError.response ? retryError.response.status : 'Unknown';
                const retryErrorData = retryError.response ? retryError.response.data : retryError.message;
                
                console.error(`❌ OneSignal Error: Access Denied (${retryStatus}).`);
                console.error('   Details:', JSON.stringify(retryErrorData));
                console.error(`   Check if ONESIGNAL_REST_API_KEY in .env is correct (starts with: ${apiKey.substring(0, 10)}...)`);
                return null;
            }
        }

        console.error(`❌ OneSignal Error (${status}):`, errorData);
        return null;
    }
};

module.exports = { sendPushNotification };

