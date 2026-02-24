const { TaskEscalation, Task } = require('./models');

async function checkRecent() {
    try {
        console.log('Fetching last 5 escalations...');
        const recent = await TaskEscalation.findAll({
            limit: 5,
            order: [['created_at', 'DESC']],
            include: [{ model: Task, attributes: ['title'] }]
        });

        recent.forEach(e => {
            console.log(`ID: ${e.id}, Task: ${e.Task?.title}, Creator(To): ${e.creator_id}, RejectedBy(From): ${e.rejected_user_id}, is_read: ${e.is_read}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkRecent();
