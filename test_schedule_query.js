require('dotenv').config();
const db = require('./models');
const { Op } = require('sequelize');

(async function () {
    try {
        console.log('=== QUICK CHECK ===\n');

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 15);

        const endDate = new Date(today);
        endDate.setDate(today.getDate() + 7);

        console.log('Date Range:');
        console.log('  Start:', startDate.toISOString().split('T')[0]);
        console.log('  End:', endDate.toISOString().split('T')[0]);

        // Get a user
        const anyAssignment = await db.TaskAssign.findOne();
        const userId = anyAssignment.user_id;

        console.log('  User:', userId);

        // Run the same query as the API
        const assignments = await db.TaskAssign.findAll({
            where: {
                user_id: userId,
                status: {
                    [Op.in]: ['accepted', 'completed']
                }
            },
            include: [{
                model: db.Task,
                where: { is_deleted: false },
                include: [{ model: db.TaskType }]
            }]
        });

        console.log('\n=== Results ===');
        console.log('Total assignments found:', assignments.length);

        const schedule = {};
        let skipped = 0;

        assignments.forEach(a => {
            const taskType = a.Task.TaskTypes?.[0];
            if (!taskType || !taskType.start_date) {
                skipped++;
                return;
            }

            const taskDate = new Date(taskType.start_date);
            const dateStr = taskDate.toISOString().split('T')[0];

            console.log(`\nTask: "${a.Task.title}"`);
            console.log(`  Date: ${dateStr}`);
            console.log(`  Status: ${a.status}`);
            console.log(`  Times: ${taskType.start_time} - ${taskType.end_time}`);
            console.log(`  In range? ${taskDate >= startDate && taskDate <= endDate ? 'YES' : 'NO'}`);

            if (taskDate < startDate || taskDate > endDate) {
                console.log('  ❌ Outside date range, skipping');
                return;
            }

            if (!schedule[dateStr]) {
                schedule[dateStr] = [];
            }

            schedule[dateStr].push({
                task_id: a.Task.task_id,
                title: a.Task.title,
                start_time: taskType.start_time,
                end_time: taskType.end_time,
                status: a.status
            });
        });

        console.log('\n\n=== FINAL SCHEDULE ===');
        console.log(`Dates with tasks: ${Object.keys(schedule).length}`);
        console.log(`Skipped (no TaskType): ${skipped}\n`);

        if (Object.keys(schedule).length > 0) {
            Object.keys(schedule).sort().forEach(date => {
                console.log(`${date}:`);
                schedule[date].forEach(task => {
                    console.log(`  - ${task.title} (${task.start_time} - ${task.end_time}) [${task.status}]`);
                });
            });
        } else {
            console.log('⚠️  No tasks in the date range!');
        }

        process.exit(0);
    } catch (error) {
        console.error('ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
