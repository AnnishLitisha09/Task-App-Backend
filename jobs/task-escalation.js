const cron = require('node-cron');
const { Task, TaskAssign, User, Student, Faculty, RoleUser } = require('../models');
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
