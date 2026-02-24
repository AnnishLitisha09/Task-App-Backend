const { TaskEscalation, Task } = require('./models');

async function checkData() {
    try {
        const userId = 40;
        console.log(`Checking escalations for User ID: ${userId}`);

        const total = await TaskEscalation.count();
        console.log(`Total escalations in DB: ${total}`);

        const myReceivedUnread = await TaskEscalation.findAll({
            where: { creator_id: userId, is_read: false },
            include: [{ model: Task, attributes: ['title'] }]
        });
        console.log(`Unread escalations received by User ${userId}: ${myReceivedUnread.length}`);
        myReceivedUnread.forEach(e => {
            console.log(`- Task: ${e.Task?.title}, Reason: ${e.reason}`);
        });

        const mySent = await TaskEscalation.findAll({
            where: { rejected_user_id: userId },
            include: [{ model: Task, attributes: ['title'] }]
        });
        console.log(`Escalations sent (rejected) by User ${userId}: ${mySent.length}`);
        mySent.forEach(e => {
            console.log(`- Task: ${e.Task?.title}, Reason: ${e.reason}, is_read: ${e.is_read}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkData();
