
const { TaskAssign, User } = require('./models');

async function debugTask284() {
    try {
        const taskId = 284;
        const assignments = await TaskAssign.findAll({
            where: { task_id: taskId }
        });

        console.log(`--- ASSIGNMENTS FOR TASK ${taskId} ---`);
        for (const a of assignments) {
            const user = await User.findByPk(a.user_id);
            console.log(`ID: ${a.id} | UserID: ${a.user_id} | Role: ${user ? user.role : 'N/A'}`);
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugTask284();
