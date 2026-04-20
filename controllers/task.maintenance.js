'use strict';
const { TaskAssign, Leave, TaskLog } = require('../models');
const { Op } = require('sequelize');

/**
 * Identifies users on approved leave for today and freezes their pending/accepted tasks.
 */
exports.freezeTasksForUsersOnLeave = async () => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // 1. Find all approved leaves that cover today
        const approvedLeaves = await Leave.findAll({
            where: {
                status: 'approved',
                from_date: { [Op.lte]: today },
                to_date: { [Op.gte]: today }
            },
            attributes: ['user_id']
        });

        if (approvedLeaves.length === 0) {
            console.log(`[MAINTENANCE] No approved leaves found for ${today}.`);
            return { frozenCount: 0 };
        }

        const userIdsOnLeave = approvedLeaves.map(l => l.user_id);

        // 2. Find all pending or accepted task assignments for these users for today
        // We filter by 'pending' or 'accepted' status
        const assignmentsToFreeze = await TaskAssign.findAll({
            where: {
                user_id: userIdsOnLeave,
                status: { [Op.in]: ['pending', 'accepted'] }
                // Note: Ideally we'd also filter by task date, but freezing all active assignments for a user on leave is safer.
            }
        });

        if (assignmentsToFreeze.length === 0) {
            console.log(`[MAINTENANCE] No active tasks to freeze for users on leave.`);
            return { frozenCount: 0 };
        }

        let count = 0;
        for (const assign of assignmentsToFreeze) {
            const oldStatus = assign.status;
            await assign.update({ status: 'frozen' });

            await TaskLog.create({
                task_id: assign.task_id,
                user_id: assign.user_id,
                action: 'freeze',
                details: `Task frozen automatically due to approved leave. Previous status: ${oldStatus}`
            });
            count++;
        }

        console.log(`[MAINTENANCE] Successfully froze ${count} tasks for ${userIdsOnLeave.length} users on leave.`);
        return { frozenCount: count };

    } catch (error) {
        console.error('[MAINTENANCE ERROR] freezeTasksForUsersOnLeave:', error.message);
        return { error: error.message };
    }
};
