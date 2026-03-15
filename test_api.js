const axios = require('axios');
const jwt = require('jsonwebtoken');

const token = jwt.sign({ user_id: 1, role: 'ADMIN' }, 'supersecretjwt');

async function test() {
    try {
        const response = await axios.get('http://localhost:3002/api/users/fetch/department-wise', {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('STATUS:', response.status);
        console.log('TYPE OF DATA:', typeof response.data);
        console.log('IS ARRAY:', Array.isArray(response.data));
        console.log('DATA KEYS:', Object.keys(response.data));
        console.log('FIRST FEW CHARS:', JSON.stringify(response.data).substring(0, 100));
    } catch (error) {
        console.error('ERROR:', error.response ? error.response.data : error.message);
    }
}

test();
