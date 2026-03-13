const { processAllEscalations } = require('./jobs/task-escalation');
const { checkMorningAcknowledgment } = require('./controllers/task.acknowledgment');
const { User, TaskAssign, Task, TaskType } = require('./models');

async function testStudentLogic() {
    try {
        console.log('--- Testing Student Escalation Logic Changes ---');

        // 1. Setup a Test Student
        let student = await User.findOne({ where: { role: 'student' } });
        if (!student) {
            student = await User.create({ name: 'Test Student', email: 'student@test.com', role: 'student' });
        }
        console.log(`Using Student ID: ${student.user_id}`);

        // 2. Setup a Test Task
        const task = await Task.create({
            title: 'Test Student Task',
            category: 'Academic',
            priority: 'medium',
            creator_id: 1
        });
        const tt = await TaskType.create({
            task_id: task.task_id,
            task_name: 'Fixed Time Task',
            start_date: new Date(),
            start_time: '00:01:00', // Definitely in the past
            end_time: '00:30:00'
        });

        const assignment = await TaskAssign.create({
            task_id: task.task_id,
            user_id: student.user_id,
            status: 'pending'
        });
        console.log(`Created Assignment ID: ${assignment.id} for Student.`);

        // 3. Test Trigger 1: Unaccepted Task (Should become 'rejected')
        console.log('\nRunning Escalation Engine (Trigger 1: Unaccepted)...');
        await processAllEscalations();

        const updatedAssign = await TaskAssign.findByPk(assignment.id);
        console.log(`New Status: ${updatedAssign.status}`);
        console.log(`Reason: ${updatedAssign.reason}`);

        if (updatedAssign.status === 'rejected') {
            console.log('✅ Trigger 1 Success: Student task rejected instead of escalated.');
        } else {
            console.log('❌ Trigger 1 Failure: Status is not rejected.');
        }

        // 4. Test Trigger 4: 24-Hour No Proof (Should become 'not_completed')
        await updatedAssign.update({ status: 'accepted' });
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 2); // 48 hours ago
        await tt.update({ start_date: yesterday, end_date: yesterday });
        
        console.log('\nRunning Escalation Engine (Trigger 4: 24hr No Proof)...');
        await processAllEscalations();

        const finalAssign = await TaskAssign.findByPk(assignment.id);
        console.log(`Final Status: ${finalAssign.status}`);
        
        if (finalAssign.status === 'not_completed') {
            console.log('✅ Trigger 4 Success: Student task marked not_completed after 24h.');
        } else {
            console.log('❌ Trigger 4 Failure: Status is not not_completed.');
        }

        // Cleanup
        await assignment.destroy({ force: true });
        await tt.destroy();
        await task.destroy();

        console.log('\nTest Complete.');
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        process.exit();
    }
}

testStudentLogic();
