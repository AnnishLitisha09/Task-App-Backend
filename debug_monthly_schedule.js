require('dotenv').config();
const { TaskAssign, Task, TaskType } = require('./models');
const { Op } = require('sequelize');

async function deepDebug() {
    try {
        console.log('=== DEEP DEBUG: Task Assignments ===\n');

        // Find the first assignment
        const anyAssignment = await TaskAssign.findOne({
            include: [{ model: Task, required: false }]
        });

        if (!anyAssignment) {
            console.log('❌ No task assignments found!');
            process.exit(0);
        }

        const userId = anyAssignment.user_id;
        console.log('Testing with user_id:', userId);

        // Get all assignments with accepted/completed status
        const assignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: {
                    [Op.in]: ['accepted', 'completed']
                }
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                required: true,
                include: [{ model: TaskType, required: false }]
            }]
        });

        console.log(`\nFound ${assignments.length} assignments with accepted/completed status\n`);

        assignments.forEach((a, idx) => {
            console.log(`Assignment #${idx + 1}:`);
            console.log('  Assignment ID:', a.id);
            console.log('  Task ID:', a.task_id);
            console.log('  Status:', a.status);
            console.log('  Task Title:', a.Task?.title);
            console.log('  Task is_deleted:', a.Task?.is_deleted);
            console.log('  TaskTypes count:', a.Task?.TaskTypes?.length || 0);

            if (a.Task?.TaskTypes?.length > 0) {
                a.Task.TaskTypes.forEach((tt, ttIdx) => {
                    console.log(`  TaskType #${ttIdx + 1}:`);
                    console.log('    ID:', tt.id);
                    console.log('    task_name:', tt.task_name);
                    console.log('    start_date:', tt.start_date);
                    console.log('    start_time:', tt.start_time);
                    console.log('    end_time:', tt.end_time);
                });
            } else {
                console.log('  ⚠️  NO TaskTypes associated with this task!');

                // Check if TaskTypes exist separately
                const directTaskTypes = await TaskType.findAll({
                    where: { task_id: a.task_id }
                });

                if (directTaskTypes.length > 0) {
                    console.log('  ❗ But TaskTypes DO exist in the database:');
                    directTaskTypes.forEach(tt => {
                        console.log('    - ID:', tt.id, 'Name:', tt.task_name, 'Start:', tt.start_date);
                    });
                    console.log('  🔍 This suggests a model association issue!');
                }
            }
            console.log('');
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

deepDebug();
