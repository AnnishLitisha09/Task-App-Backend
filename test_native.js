const http = require('http');
const jwt = require('jsonwebtoken');

const token = jwt.sign({ user_id: 1, role: 'ADMIN' }, 'supersecretjwt');

const options = {
    hostname: 'localhost',
    port: 3002,
    path: '/api/users/fetch/department-wise',
    method: 'GET',
    headers: {
        'Authorization': 'Bearer ' + token
    }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log('STATUS:', res.statusCode);
        console.log('FIRST 100 CHARS:', data.substring(0, 100));
        try {
            const parsed = JSON.parse(data);
            console.log('IS ARRAY:', Array.isArray(parsed));
            if (Array.isArray(parsed)) {
                console.log('ARRAY LENGTH:', parsed.length);
            } else {
                console.log('KEYS:', Object.keys(parsed));
            }
        } catch (e) {
            console.log('FAILED TO PARSE JSON');
        }
    });
});

req.on('error', (e) => {
    console.error('ERROR:', e.message);
});

req.end();
