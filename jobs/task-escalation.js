const cron = require('node-cron');
const { Task, TaskAssign, User, TaskType, TaskEscalation, Notification, TaskLog } = require('../models');
const { Op } = require('sequelize');
const { getSupervisor } = require('../utils/hierarchy');

/**
 * Main Escalation Engine
 * Checks for:
 * 1. Unaccepted Tasks (Still pending after start time)
 * 2. Overdue Tasks (Not completed 1 hour after end time)
 */
const processAllEscalations = async () => {
    try {
        if (new Date().getDay() === 0) return; // Skip Sunday

        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const todayStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
        const localTimeStr = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}:00`;

        console.log(`[CRON] Escalation Engine Running at ${localTimeStr}`);

        // Trigger 1: UNACCEPTED tasks (status 'pending' and start_time passed)
        const unaccepted = await TaskAssign.findAll({
            where: { status: 'pending' },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }]
            }]
        });

        for (const a of unaccepted) {
            const tt = a.Task?.TaskTypes?.[0];
            if (!tt) continue;

            const taskStartStr = new Date(tt.start_date).toISOString().split('T')[0];
            const taskStartTime = tt.start_time;

            if (taskStartStr < todayStr || (taskStartStr === todayStr && localTimeStr > taskStartTime)) {
                await escalateAssignment(a, 'Task Not Accepted by Start Time');
            }
        }

        // Trigger 2: OVERDUE tasks (status 'accepted'/'in_progress', end_time + 1 hour passed)
        const overdue = await TaskAssign.findAll({
            where: { status: { [Op.in]: ['accepted', 'in_progress'] } },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }]
            }]
        });

        for (const a of overdue) {
            const tt = a.Task?.TaskTypes?.[0];
            if (!tt) continue;

            const isLongTask = tt.task_name === 'Date-Only / Long Task' || tt.task_name === 'Long Task';
            const taskEndStr = new Date(tt.end_date || tt.start_date).toISOString().split('T')[0];
            const taskEndTime = isLongTask ? '16:30:00' : tt.end_time;

            if (!taskEndTime) continue;

            const [h, m] = taskEndTime.split(':').map(Number);
            const endMinutes = h * 60 + m + 60; // +1 hour delay buffer
            const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();

            if (taskEndStr < todayStr || (taskEndStr === todayStr && currentMinutes > endMinutes)) {
                await escalateAssignment(a, 'Task Overdue (1 Hour Buffer Passed)');
            }
        }

    } catch (error) {
        console.error('[CRON ERROR] Escalation Engine:', error);
    }
};

/**
 * Internal helper to handle the escalation of a single assignment
 */
const escalateAssignment = async (assign, reason) => {
    try {
        const supervisorId = await getSupervisor(assign.user_id);
        if (!supervisorId) return;

        // 1. Move status to escalated
        await assign.update({ status: 'escalated' });
        await Task.update({ is_escalate: true }, { where: { task_id: assign.task_id } });

        // 2. Log Action
        await TaskLog.create({
            task_id: assign.task_id,
            user_id: assign.user_id,
            action: 'escalation',
            details: `System Escalated to User ${supervisorId}: ${reason}`
        });

        // 3. Create Formal Escalation Record
        await TaskEscalation.create({
            task_id: assign.task_id,
            reason: reason,
            msg: `Task "${assign.Task.title}" failed compliance: ${reason}.`,
            creator_id: supervisorId, // To supervisor
            rejected_user_id: assign.user_id, // From user
            status: 'pending'
        });

        // 4. Notify Supervisor
        await Notification.create({
            user_id: supervisorId,
            title: 'Task Escalation Alert',
            msg: `URGENT: Task "${assign.Task.title}" assigned to User ${assign.user_id} has been escalated. Reason: ${reason}`,
            type: 'task_escalation'
        });

        console.log(`[ESCALATION] Task ${assign.task_id} for User ${assign.user_id} escalated to Supervisor ${supervisorId}`);
    } catch (err) {
        console.error(`Error escalating assignment ${assign.id}:`, err);
    }
};

// Schedule: Every 15 minutes
cron.schedule('*/15 * * * *', processAllEscalations);

module.exports = { processAllEscalations };
