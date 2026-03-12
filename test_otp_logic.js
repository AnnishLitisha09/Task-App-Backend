const { TaskOTP } = require('./models');

async function test() {
  try {
    console.log('--- Testing OTP Destroy Logic (Universal) ---');
    const finalTaskId = 284;
    const type = 'START';

    // This should mimic line 63-69 of task.otp.controller.js
    await TaskOTP.destroy({
      where: {
          task_id: finalTaskId,
          otp_type: type,
          is_used: false
      },
      logging: console.log // Capture the SQL
    });
    console.log('✅ Destroy successful');

    console.log('\n--- Testing OTP Create Logic (Universal) ---');
    await TaskOTP.create({
        assignment_id: null,
        task_id: finalTaskId,
        otp_code: '123456',
        otp_type: type,
        expires_at: new Date(Date.now() + 60000),
        logging: console.log // Capture the SQL
    });
    console.log('✅ Create successful');

  } catch (err) {
    console.error('❌ TEST ERROR:', err.message);
    if (err.sql) console.log('SQL RUN:', err.sql);
  } finally {
    process.exit();
  }
}

test();
