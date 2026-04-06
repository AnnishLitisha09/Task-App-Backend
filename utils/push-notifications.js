const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let fcmInitialized = false;

try {
    const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        fcmInitialized = true;
        console.log('✅ Firebase Admin SDK Initialized');
    } else {
        console.warn('⚠️ Firebase serviceAccountKey.json not found at ' + serviceAccountPath + '. Push notifications will be logged only.');
    }
} catch (error) {
    console.error('❌ Failed to initialize Firebase Admin:', error.message);
}

/**
 * Sends a push notification to a specific user.
 */
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
    if (!fcmInitialized || !fcmToken) {
        console.log(`[FCM Mock] Target: ${fcmToken || 'No Token'}, Title: ${title}, Body: ${body}`);
        return;
    }

    const message = {
        notification: { 
            title: title || 'Task App Notification',
            body: body || 'You have a new update.'
        },
        data: {
            ...data,
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        token: fcmToken
    };

    try {
        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);
        return response;
    } catch (error) {
        console.error('Error sending FCM message to token ' + fcmToken + ':', error.message);
        // If token is invalid/expired, we might want to clear it from DB in a real app
    }
};

module.exports = { sendPushNotification };
