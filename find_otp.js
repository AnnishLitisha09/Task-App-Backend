
const { TaskOTP } = require('./models');

async function findOTP() {
    try {
        const otp = await TaskOTP.findOne({ where: { otp_code: '341379' } });
        console.log('OTP_FOUND:' + (otp ? otp.assignment_id + '|USED:' + otp.is_used + '|EXP:' + otp.expires_at : 'NONE'));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

findOTP();
