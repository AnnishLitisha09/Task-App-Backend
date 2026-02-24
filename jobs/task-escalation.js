const cron = require('node-cron');
const { Task, TaskAssign, User, Student, Faculty, RoleUser, Notification, TaskType } = require('../models');
const { Op } = require('sequelize');

/**
 * Task Escalation Cron Job
 * Runs every day at midnight (00:00)
 * Logic:
 * 1. Find tasks whose end_date was yesterday.
 * 2. Identify users who haven't completed their assignment.
 * 3. Set task.is_escalate = true if there are pending assignments.
 */
exports.runTaskEscalation = async () => {
    try {
        // --- NEW: Sunday Skip ---
        if (new Date().getDay() === 0) {
            console.log('[CRON] Skipping task escalation - It is Sunday (Holiday).');
            return { escalated: 0 };
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        console.log(`[CRON] Running daily task escalation check for date: ${yesterdayStr}`);

        // Find tasks that ended yesterday
        // Note: We need to pull from TaskType via association or raw query if joined
        // For simplicity, let's look for all Active tasks and filter by their TaskType end_date
        const tasks = await Task.findAll({
            where: { status: 'Active', is_deleted: false },
            include: [{
                model: require('../models').TaskType,
                where: {
                    end_date: {
                        [Op.lt]: new Date() // Deadline has passed
                    }
                }
            }]
        });

        let escalationCount = 0;

        for (const task of tasks) {
            // Find pending assignments for this task
            const pendingAssignments = await TaskAssign.findAll({
                where: {
                    task_id: task.task_id,
                    status: 'pending'
                }
            });

            if (pendingAssignments.length > 0) {
                // Escalate the task
                await task.update({ is_escalate: true });
                escalationCount++;

                console.log(`[CRON] Task escalated: ${task.title} (ID: ${task.task_id}) - ${pendingAssignments.length} users pending.`);

                // TODO: In a real system, you'd send an email/notification here
                // to task.creator_id with the list of pending users.
            }
        }

        console.log(`[CRON] Task escalation check completed. ${escalationCount} tasks escalated.`);
        return { escalated: escalationCount };

    } catch (error) {
        console.error('[CRON ERROR] runTaskEscalation:', error.message);
        return { error: error.message };
    }
};
/**
 * Check Task Acceptance Status (30 minutes before start)
 * Logic:
 * 1. Find tasks starting in the next 30-45 minutes.
 * 2. Check for pending assignments.
 * 3. Notify creator with summary.
 */
exports.checkTaskAcceptance = async () => {
    try {
        // --- NEW: Sunday Skip ---
        if (new Date().getDay() === 0) {
            console.log('[CRON] Skipping task acceptance check - It is Sunday (Holiday).');
            return;
        }

        const now = new Date();
        const thirtyMinsLater = new Date(now.getTime() + 30 * 60000);
        const fortyFiveMinsLater = new Date(now.getTime() + 45 * 60000);

        console.log(`[CRON] Checking acceptance for tasks starting between ${thirtyMinsLater.toLocaleTimeString()} and ${fortyFiveMinsLater.toLocaleTimeString()}`);

        const taskTypes = await TaskType.findAll({
            where: {
                start_date: now.toISOString().split('T')[0],
                start_time: {
                    [Op.between]: [
                        thirtyMinsLater.toTimeString().split(' ')[0],
                        fortyFiveMinsLater.toTimeString().split(' ')[0]
                    ]
                }
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskAssign }]
            }]
        });

        for (const tt of taskTypes) {
            const task = tt.Task;
            if (!task) continue;

            const assignments = task.TaskAssigns || [];
            const pendingCount = assignments.filter(a => a.status === 'pending').length;
            const acceptedCount = assignments.filter(a => a.status === 'accepted' || a.status === 'completed').length;

            if (pendingCount > 0) {
                // Send notification to creator
                await Notification.create({
                    user_id: task.creator_id,
                    title: 'Task Acceptance Alert',
                    msg: `URGENT: Your task "${task.title}" starts in 30 minutes. ${acceptedCount} accepted, ${pendingCount} still pending!`,
                    type: 'task_escalation'
                });

                // Also create formal escalation if not already done
                if (!task.is_escalate) {
                    await task.update({ is_escalate: true });
                    await TaskEscalation.create({
                        task_id: task.task_id,
                        reason: `System: ${pendingCount} users have not accepted the task 30 minutes before start.`,
                        creator_id: task.creator_id,
                        rejected_user_id: task.creator_id, // Assigned to creator as alert
                        status: 'pending'
                    });
                }
            }
        }
    } catch (error) {
        console.error('[CRON ERROR] checkTaskAcceptance:', error.message);
    }
};
