require('dotenv').config();
const db = require('./models');
const { Op } = require('sequelize');

(async function checkDatabase() {
    try {
        console.log('=== DATABASE CHECK ===\n');

        // 1. Check total counts
        const totalAssignments = await db.TaskAssign.count();
        const totalTasks = await db.Task.count();
        const totalTaskTypes = await db.TaskType.count();

        console.log('Total Counts:');
        console.log('  TaskAssignments:', totalAssignments);
        console.log('  Tasks:', totalTasks);
        console.log('  TaskTypes:', totalTaskTypes);

        // 2. Find a user with assignments
        const assignment = await db.TaskAssign.findOne();
        if (!assignment) {
            console.log('\n❌ No assignments found!');
            process.exit(0);
        }

        const userId = assignment.user_id;
        console.log('\n\nTesting with user_id:', userId);

        // 3. Count by status
        const statusCounts = await db.TaskAssign.findAll({
            where: { user_id: userId },
            attributes: [
                'status',
                [db.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['status'],
            raw: true
        });

        console.log('\nUser assignments by status:');
        statusCounts.forEach(s => {
            console.log(`  ${s.status}: ${s.count}`);
        });

        // 4. Get actual data
        console.log('\n=== Sample Assignments (accepted or completed) ===');
        const assignments = await db.TaskAssign.findAll({
            where: {
                user_id: userId,
                status: {
                    [Op.in]: ['accepted', 'completed']
                }
            },
            limit: 5,
            include: [{
                model: db.Task,
                where: { is_deleted: false },
                required: true,
                include: [{
                    model: db.TaskType,
                    required: false
                }]
            }]
        });

        console.log(`Found ${assignments.length} assignments\n`);

        for (const [idx, a] of assignments.entries()) {
            console.log(`Assignment ${idx + 1}:`);
            console.log('  ID:', a.id);
            console.log('  Status:', a.status);
            console.log('  Task ID:', a.task_id);
            console.log('  Task Title:', a.Task?.title || 'N/A');

            if (!a.Task) {
                console.log('  ⚠️  Task not loaded!');
            } else {
                const types = a.Task.TaskTypes || [];
                console.log(`  TaskTypes: ${types.length}`);

                if (types.length > 0) {
                    types.forEach(tt => {
                        console.log(`    - ${tt.task_name} | ${tt.start_date} ${tt.start_time}-${tt.end_time}`);
                    });
                } else {
                    console.log('    ⚠️  No TaskTypes loaded!');

                    // Check directly
                    const direct = await db.TaskType.findAll({
                        where: { task_id: a.task_id }
                    });

                    if (direct.length > 0) {
                        console.log(`    ❗ Found ${direct.length} TaskTypes in database:`);
                        direct.forEach(tt => {
                            console.log(`       - ${tt.task_name} | ${tt.start_date} ${tt.start_time}-${tt.end_time}`);
                        });
                    }
                }
            }
            console.log('');
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
