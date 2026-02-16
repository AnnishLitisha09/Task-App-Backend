const axios = require('axios');

async function testMonthlySchedule() {
    try {
        // Replace with actual JWT token from your login
        const token = 'YOUR_JWT_TOKEN_HERE';

        const response = await axios.get('http://localhost:3002/api/tasks/schedule/monthly', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('=== MONTHLY SCHEDULE API RESPONSE ===');
        console.log(JSON.stringify(response.data, null, 2));

        const { range, schedule } = response.data;
        console.log('\n=== SUMMARY ===');
        console.log('Date Range:', range.start, 'to', range.end);
        console.log('Total Days with Tasks:', Object.keys(schedule).length);

        Object.keys(schedule).forEach(date => {
            console.log(`\n${date}: ${schedule[date].length} task(s)`);
            schedule[date].forEach(task => {
                console.log(`  - ${task.title} (${task.start_time} - ${task.end_time}) [${task.status}]`);
            });
        });

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

testMonthlySchedule();
