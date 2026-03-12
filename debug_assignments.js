
const { TaskAssign } = require('./models');

async function debugAssignments() {
    try {
        const assignments = await TaskAssign.findAll({
            limit: 5,
            order: [['id', 'DESC']]
        });

        assignments.forEach(a => {
            console.log('ID:' + a.id + '|TID:' + a.task_id + '|UID:' + a.user_id + '|STAT:' + a.status);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugAssignments();
