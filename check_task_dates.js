require('dotenv').config();
const db = require('./models');
const { Op } = require('sequelize');

(async function () {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        console.log('Today:', today.toISOString().split('T')[0]);

        // Get a user
        const anyAssignment = await db.TaskAssign.findOne();
        if (!anyAssignment) {
            console.log('No assignments found!');
            process.exit(0);
        }

        const userId = anyAssignment.user_id;
        console.log('User ID:', userId);

        // Find all task dates for this user
        const assignments = await db.TaskAssign.findAll({
            where: { user_id: userId, status: { [Op.in]: ['accepted', 'completed'] } },
            include: [{ model: db.Task, where: { is_deleted: false }, include: [db.TaskType] }]
        });

        console.log(`\nTotal assignments (accepted/completed): ${assignments.length}\n`);

        const dates = [];
        assignments.forEach(a => {
            const tt = a.Task?.TaskTypes?.[0];
            if (tt?.start_date) {
                dates.push(new Date(tt.start_date));
                console.log(`- ${a.Task.title}: ${new Date(tt.start_date).toISOString().split('T')[0]} (${a.status})`);
            }
        });

        if (dates.length > 0) {
            dates.sort((a, b) => a - b);
            const earliest = dates[0];
            const latest = dates[dates.length - 1];

            console.log(`\n=== Date Summary ===`);
            console.log('Earliest task:', earliest.toISOString().split('T')[0]);
            console.log('Latest task:', latest.toISOString().split('T')[0]);
            console.log('Today:', today.toISOString().split('T')[0]);

            // Calculate date range
            const startDate = new Date(today);
            startDate.setDate(today.getDate() - 15);
            const endDate = new Date(today);
            endDate.setDate(today.getDate() + 7);

            console.log('\nAPI Date Range:');
            console.log('  Start (Today - 15):', startDate.toISOString().split('T')[0]);
            console.log('  End (Today + 7):', endDate.toISOString().split('T')[0]);

            const inRange = dates.filter(d => d >= startDate && d <= endDate);
            console.log(`\nTasks in range: ${inRange.length} / ${dates.length}`);
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();
