const { TaskAssign, User, Task } = require('./models');

async function debug() {
    console.log('--- DEBUG DIRECT INSERT ---');
    try {
        const taskId = 26; // User said task 26 created
        const userId = 40; // Target user

        // Check if they exist first
        const task = await Task.findByPk(taskId);
        const user = await User.findByPk(userId);

        console.log(`Task ${taskId} exists: ${!!task}`);
        console.log(`User ${userId} exists: ${!!user}`);

        if (!task || !user) {
            console.log('Cannot proceed with insert test.');
            return;
        }

        console.log('Attempting TaskAssign.create...');
        const assignment = await TaskAssign.create({
            task_id: taskId,
            user_id: userId,
            status: 'pending'
        });

        console.log('Insert Success! Assignment ID:', assignment.id);

        // Retrieve it to be sure
        const found = await TaskAssign.findOne({ where: { id: assignment.id } });
        console.log('Retrieved from DB:', found ? found.toJSON() : 'NOT FOUND IN DB!');

    } catch (e) {
        console.error('Insert Failed:', e.message);
    }
}

debug();
