const { User, Staff, Faculty } = require('./models');

async function generateCurl() {
    try {
        // Find an admin or faculty user to be the assigner
        const assigner = await User.findOne({ where: { role: 'admin' } });
        if (!assigner) { console.log('No admin user found'); return; }

        // Find all staff who HAVE a user record
        const validStaffUsers = await Staff.findAll({
            include: [{ model: User, required: true }]
        });
        const staffIds = validStaffUsers.map(s => s.user_id);

        console.log('--- FOUND VALID USERS ---');
        console.log('Staff with User records:', staffIds);
        
        const payload = {
            task_title_id: 1,
            description: "Test Assignment to All Valid Staff",
            category: "Administrative",
            priority: "medium",
            origin_type: "directive",
            venue_id: 1,
            score: 10,
            is_mandatory: false,
            task_type_data: {
                task_name: "Fixed Time Task",
                start_date: new Date().toISOString().split('T')[0],
                end_date: new Date().toISOString().split('T')[0],
                start_time: "10:00:00",
                end_time: "11:00:00"
            },
            assignee_ids: staffIds
        };

        console.log('\n--- CURL COMMAND ---');
        console.log(`curl -X POST http://localhost:3002/api/tasks/unified-create \\`);
        console.log(`  -H "Authorization: Bearer YOUR_TOKEN" \\`);
        console.log(`  -H "Content-Type: application/json" \\`);
        console.log(`  -d '${JSON.stringify(payload)}'`);

    } catch (e) {
        console.error(e);
    }
    process.exit();
}
generateCurl();
