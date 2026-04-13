const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

async function testToken() {
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    const serviceAccount = require(serviceAccountPath);

    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }

    try {
        const token = await admin.app().INTERNAL.getToken();
        console.log('Successfully fetched token:', token.accessToken.substring(0, 10) + '...');
    } catch (error) {
        console.error('Failed to fetch token:');
        console.error(JSON.stringify(error, null, 2));
    }
}

testToken();
