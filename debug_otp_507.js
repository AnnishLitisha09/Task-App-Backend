
const { TaskOTP, TaskAssign } = require('./models');

async function debugOTP() {
    try {
        const assignmentId = 507;
        const otpCode = "341379";

        const otp = await TaskOTP.findOne({
            where: { assignment_id: assignmentId, otp_code: otpCode }
        });

        const allOTPsForAssignment = await TaskOTP.findAll({
            where: { assignment_id: assignmentId },
            order: [['created_at', 'DESC']]
        });

        console.log('--- TARGET OTP ---');
        console.log(JSON.stringify(otp, null, 2));
        
        console.log('\n--- ALL OTPS FOR ASSIGNMENT ---');
        allOTPsForAssignment.forEach(o => {
            console.log(`Code: ${o.otp_code}, Type: ${o.otp_type}, Used: ${o.is_used}, Expires: ${o.expires_at}, Created: ${o.created_at}`);
        });

        console.log('\n--- CURRENT TIME ---');
        console.log(new Date().toISOString());

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugOTP();
