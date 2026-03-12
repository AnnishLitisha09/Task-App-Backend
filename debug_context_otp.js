
const { TaskOTP, TaskAssign } = require('./models');
const { Op } = require('sequelize');

async function debugContext() {
    try {
        const a507 = await TaskAssign.findByPk(507);
        const a508 = await TaskAssign.findByPk(508);
        const otps = await TaskOTP.findAll({ limit: 5, order: [['created_at', 'DESC']] });

        console.log('A507:' + (a507 ? a507.id : 'NONE'));
        console.log('A508:' + (a508 ? a508.id : 'NONE'));
        otps.forEach(o => {
            console.log('OTP:' + o.otp_code + '|AID:' + o.assignment_id + '|USED:' + o.is_used + '|EXP:' + o.expires_at.toISOString());
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugContext();
