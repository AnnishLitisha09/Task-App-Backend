
const { TaskAssign } = require('./models');

async function debugCompare() {
    try {
        const a507 = await TaskAssign.findByPk(507);
        const a508 = await TaskAssign.findByPk(508);
        console.log('A507:UID:' + (a507 ? a507.user_id : 'NONE'));
        console.log('A508:UID:' + (a508 ? a508.user_id : 'NONE'));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugCompare();
