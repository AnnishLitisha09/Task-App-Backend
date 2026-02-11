const db = require('./models');

async function verifyTasks() {
    try {
        await db.sequelize.authenticate();

        // 1. Check if we can create a task with times
        console.log('Testing Task Creation...');
        const task = await db.Task.create({
            title: "Test Task with Times",
            category: "Academic",
            priority: "high",
            creator_id: 1, // Assuming admin or existing user
            status: "Active"
        });

        const taskType = await db.TaskType.create({
            task_id: task.task_id,
            task_name: "Fixed Time Task",
            start_time: "09:00:00",
            end_time: "17:00:00",
            start_date: new Date()
        });

        console.log(`Created Task ID: ${task.task_id} with Type ID: ${taskType.id}`);
        console.log(`Saved Times: ${taskType.start_time} - ${taskType.end_time}`);

        // Fetch back to verify
        const fetched = await db.TaskType.findByPk(taskType.id);
        if (fetched.start_time === "09:00:00" && fetched.end_time === "17:00:00") {
            console.log('✅ Success: Times correctly stored.');
        } else {
            console.log(`❌ Error: Times not correctly stored. Got: ${fetched.start_time} - ${fetched.end_time}`);
        }

        // 2. Test Closure Logic
        console.log('Testing Task Closure...');
        await task.update({ status: 'Inactive' });
        const updatedTask = await db.Task.findByPk(task.task_id);
        if (updatedTask.status === 'Inactive') {
            console.log('✅ Success: Task status correctly updated to Inactive.');
        } else {
            console.log(`❌ Error: Task status not updated. Got: ${updatedTask.status}`);
        }

        // Cleanup test data
        await db.Task.destroy({ where: { task_id: task.task_id } });

    } catch (err) {
        console.error('Verification Error:', err.message);
    } finally {
        process.exit();
    }
}

verifyTasks();
