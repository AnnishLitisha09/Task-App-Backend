
const { TaskAssign, TaskOTP } = require('./models');

async function debugAll() {
    try {
        const a507 = await TaskAssign.findByPk(507, { paranoid: false });
        const o507 = await TaskOTP.findOne({ where: { assignment_id: 507 } });

        console.log('A507:' + (a507 ? a507.id + '|UID:' + a507.user_id + '|DEL:' + !!a507.deleted_at : 'NONE'));
        console.log('O507:' + (o507 ? o507.otp_code + '|USED:' + o507.is_used : 'NONE'));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugAll();
