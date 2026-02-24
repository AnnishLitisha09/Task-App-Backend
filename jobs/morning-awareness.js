const cron = require('node-cron');
const { checkMorningAcknowledgment, cleanupOldAcknowledgments } = require('../controllers/task.acknowledgment');
const { freezeTasksForUsersOnLeave } = require('../controllers/task.maintenance');

// Morning Awareness System

// Job 0: 00:05 AM - Freeze tasks for users on approved leave
cron.schedule('5 0 * * *', async () => {
    if (new Date().getDay() === 0) return; // Skip Sunday
    console.log('[CRON] Running leave-based task freezing at 00:05 AM');
    await freezeTasksForUsersOnLeave();
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

// Job 1: 06:00 AM - Create acknowledgment records for today's tasks
// Note: This will be triggered by frontend when user logs in
// or can be implemented as a push notification system

// Job 2: 08:30 AM - Check for unacknowledged tasks and escalate
cron.schedule('30 8 * * *', async () => {
    if (new Date().getDay() === 0) return; // Skip Sunday
    console.log('[CRON] Running morning acknowledgment check at 08:30 AM');
    const result = await checkMorningAcknowledgment();
    console.log(`[CRON] Escalated ${result.count || 0} unacknowledged tasks`);
}, {
    scheduled: true,
    timezone: "Asia/Kolkata" // Adjust to your timezone
});

// Job 3: 01:00 AM - Cleanup old acknowledgments (older than 7 days)
cron.schedule('0 1 * * *', async () => {
    console.log('[CRON] Running acknowledgment cleanup at 01:00 AM');
    const result = await cleanupOldAcknowledgments();
    console.log(`[CRON] Deleted ${result.deleted || 0} old acknowledgments`);
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

console.log('✅ Task acknowledgment cron jobs initialized');
console.log('   - 08:30 AM: Check unacknowledged tasks');
console.log('   - 01:00 AM: Cleanup old data');

module.exports = { cron };
