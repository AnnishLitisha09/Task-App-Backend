const { checkTaskOverlap } = require('./utils/task-utils');
const { Task, TaskType, TaskAssign, User, Student, Faculty, Staff, RoleUser, TaskPackageClosure, TaskClosure } = require('./models');

async function verify() {
    try {
        console.log('--- Testing Overlap Logic ---');
        // Scenario: Standard tasks overlap in time on same date
        const overlapResult = await checkTaskOverlap(14, {
            start_date: '2026-03-11',
            end_date: '2026-03-11',
            start_time: '10:00',
            end_time: '11:00',
            task_name: 'Fixed Time Task'
        });
        console.log('Overlap Result:', JSON.stringify(overlapResult, null, 2));

        console.log('\n--- Testing Daily Report Data Fetching ---');
        // Since I can't easily mock the request/response here, I'll just check the query logic for a sample user
        const userId = 40; // Sample faculty user
        const sampleTask = await Task.findOne({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskAssign,
                    include: [{ 
                        model: User, 
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }]
                }
            ]
        });

        if (sampleTask) {
            console.log('Sample Task Fetch Successful:');
            console.log('Title:', sampleTask.title);
            console.log('Closures Count:', sampleTask.TaskPackageClosures?.length || 0);
            if (sampleTask.TaskPackageClosures?.length > 0) {
                console.log('First Closure Name:', sampleTask.TaskPackageClosures[0].TaskClosure?.name);
            }
            console.log('Assignees Count:', sampleTask.TaskAssigns?.length || 0);
            if (sampleTask.TaskAssigns?.length > 0) {
                const u = sampleTask.TaskAssigns[0].User;
                const profile = u.Student || u.Faculty || u.Staff || u.RoleUser || {};
                console.log('First Assignee Name:', profile.name || 'Unknown');
                console.log('First Assignee Role:', u.role);
            }
        } else {
            console.log('No sample task found for user 40');
        }

    } catch (err) {
        console.error('Verification failed:', err);
    } finally {
        process.exit();
    }
}

verify();
