const crypto = require('crypto');
const fs = require('fs');

try {
    const json = JSON.parse(fs.readFileSync('serviceAccountKey.json', 'utf8'));
    const privateKey = json.private_key;
    
    // Check if key is valid RSA
    const pkey = crypto.createPrivateKey(privateKey);
    console.log('Private key is validly formatted RSA.');
    console.log('Key Details:', pkey.export({ type: 'pkcs1', format: 'pem' }).substring(0, 50) + '...');
} catch (error) {
    console.error('Private key format error:');
    console.error(error.message);
}
