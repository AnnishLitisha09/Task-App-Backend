const { checkTaskOverlap } = require('./utils/task-utils');
const { Task, TaskType, TaskAssign } = require('./models');

async function testOverlap() {
    try {
        console.log('--- Setting up Test Data for Overlap ---');
        const userId = 999; // Dummy test user
        
        // 1. Create an 'accepted' task
        const task1 = await Task.create({
            title: 'Existing Accepted Task',
            category: 'Admin',
            priority: 'medium',
            creator_id: 1,
            status: 'Active'
        });
        await TaskType.create({
            task_id: task1.task_id,
            task_name: 'Fixed Time Task',
            start_date: '2026-05-20',
            end_date: '2026-05-20',
            start_time: '09:00',
            end_time: '10:00'
        });
        await TaskAssign.create({
            task_id: task1.task_id,
            user_id: userId,
            status: 'accepted'
        });

        // 2. Test Conflict: Same time, same date
        console.log('Test 1: Same time, same date');
        const res1 = await checkTaskOverlap(userId, {
            start_date: '2026-05-20',
            end_date: '2026-05-20',
            start_time: '09:00',
            end_time: '10:00',
            task_name: 'Fixed Time Task'
        });
        console.log('Result 1:', res1.hasConflict ? `✅ Conflict Detected: ${res1.conflictTask.reason}` : '❌ NO Conflict (FAILED)');

        // 3. Test Conflict: Overlapping time (9:30 - 10:30)
        console.log('\nTest 2: Overlapping time (09:30 - 10:30)');
        const res2 = await checkTaskOverlap(userId, {
            start_date: '2026-05-20',
            end_date: '2026-05-20',
            start_time: '09:30',
            end_time: '10:30',
            task_name: 'Fixed Time Task'
        });
        console.log('Result 2:', res2.hasConflict ? `✅ Conflict Detected: ${res2.conflictTask.reason}` : '❌ NO Conflict (FAILED)');

        // 4. Test Conflict: Long Task vs Standard Task
        console.log('\nTest 3: Long Task overlapping the date');
        const res3 = await checkTaskOverlap(userId, {
            start_date: '2026-05-20',
            end_date: '2026-05-20',
            task_name: 'Long Task'
        });
        console.log('Result 3:', res3.hasConflict ? `✅ Conflict Detected: ${res3.conflictTask.reason}` : '❌ NO Conflict (FAILED)');

        // 5. Test Non-Conflict: Different time
        console.log('\nTest 4: Different time (11:00 - 12:00)');
        const res4 = await checkTaskOverlap(userId, {
            start_date: '2026-05-20',
            end_date: '2026-05-20',
            start_time: '11:00',
            end_time: '12:00',
            task_name: 'Fixed Time Task'
        });
        console.log('Result 4:', res4.hasConflict ? `❌ Conflict (FAILED): ${res4.conflictTask.reason}` : '✅ No Conflict (PASSED)');

        // Cleanup
        await TaskAssign.destroy({ where: { user_id: userId } });
        await TaskType.destroy({ where: { task_id: task1.task_id } });
        await Task.destroy({ where: { task_id: task1.task_id } });

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        process.exit();
    }
}

testOverlap();
