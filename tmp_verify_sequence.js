const { Task, TaskAssign, TaskType, User } = require('./models');
const { createUnifiedTask } = require('./controllers/task.controller');

async function testSequence() {
    try {
        console.log('--- STEP 1: Creating Package with 2 Sub-tasks ---');
        const req = {
            userId: 2,
            userRole: 'faculty',
            body: {
                title: 'Sequential Package Test',
                category: 'Admin',
                priority: 'medium',
                is_package: true,
                faculty_id: 1,
                task_type_data: {
                    task_name: 'Fixed Time Task',
                    start_date: '2026-03-25',
                    start_time: '09:00:00'
                },
                sub_tasks: [
                    {
                        title: 'Sub 1 (2h)',
                        max_duration_hours: 2,
                        assignee_ids: [3]
                    },
                    {
                        title: 'Sub 2 (2h)',
                        max_duration_hours: 2,
                        assignee_ids: [3]
                    }
                ]
            }
        };

        const res = {
            status: (s) => ({ json: (d) => { if(s >= 400) console.log('Error:', s, d); } }),
            json: (d) => { console.log('Created:', d.message, 'TaskIDs:', d.task_ids); }
        };

        await createUnifiedTask(req, res);

        // Find the sub-tasks
        const parentTask = await Task.findOne({ where: { title: 'Sequential Package Test' }, order: [['task_id', 'DESC']] });
        if (!parentTask) throw new Error('Parent task not created');

        const subs = await Task.findAll({ 
            where: { parent_task_id: parentTask.task_id },
            order: [['sequence_order', 'ASC']],
            include: [TaskType, TaskAssign]
        });

        console.log(`Sub 1 (ID ${subs[0].task_id}) Status: ${subs[0].status}, Assign Status: ${subs[0].TaskAssigns[0].status}`);
        console.log(`Sub 2 (ID ${subs[1].task_id}) Status: ${subs[1].status}, Assign Status: ${subs[1].TaskAssigns[0].status}`);

        if (subs[0].status !== 'Active' || subs[1].status !== 'Inactive') {
            console.error('FAILED: Initial statuses incorrect');
        }

        console.log('--- STEP 2: Completing Sub-task 1 ---');
        // We simulate the completion logic directly or call the controller
        // Actually, we should call the controller function that handles completion
        // Let's find it. It's likely exports.submitProof in task.controller.js
        
        // Mocking the 'assignment' object for submitProof
        // But it's easier to just trigger the trigger logic I added
        
        const assignment1 = await TaskAssign.findOne({ where: { task_id: subs[0].task_id } });
        await assignment1.update({ status: 'completed' }); 
        
        // Manual trigger of the logic I added (since I inserted it into the controller and I'm not calling the API here)
        // Wait, if I'm running this script, the 'afterUpdate' hook wouldn't exist unless I added it.
        // My logic is in the controller's submitProof. I should call submitProof!
        
    } catch (e) {
        console.error('Test Error:', e);
    }
    process.exit(0);
}

testSequence();
