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

    try {
        const response = await axios.post('https://onesignal.com/api/v1/notifications', {
            app_id: ONESIGNAL_APP_ID,
            include_external_user_ids: ids,
            headings: { en: title },
            contents: { en: message },
            data: data
        }, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            }
        });

        console.log('✅ OneSignal Notification Sent:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ OneSignal Error:', error.response ? error.response.data : error.message);
    }
};

module.exports = { sendPushNotification };
