
const { TaskOTP, TaskAssign } = require('./models');

async function debugGeneral() {
    try {
        const assignment = await TaskAssign.findByPk(507);
        const last10OTPs = await TaskOTP.findAll({
            limit: 10,
            order: [['created_at', 'DESC']]
        });

        console.log('--- ASSIGNMENT 507 ---');
        console.log(JSON.stringify(assignment, null, 2));
        
        console.log('\n--- LAST 10 OTPS ---');
        last10OTPs.forEach(o => {
            console.log(`ID: ${o.otp_id}, Code: ${o.otp_code}, AssignID: ${o.assignment_id}, Used: ${o.is_used}, Type: ${o.otp_type}, Expires: ${o.expires_at}`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugGeneral();
