const { Task, TaskType, TaskAssign } = require('../models');
const { Op } = require('sequelize');

/**
 * Checks if a proposed task overlaps with any existing 'accepted', 'completed', or 'in_progress' tasks for a user.
 * @param {number} userId - ID of the user to check conflicts for.
 * @param {object} taskDetails - Details of the proposed task: { start_date, end_date, start_time, end_time, task_name }
 * @param {number} [excludeTaskId] - Optional ID to exclude from checks (useful for updates).
 * @returns {Promise<object>} - { hasConflict: boolean, conflictTask: object | null }
 */
async function checkTaskOverlap(userId, taskDetails, excludeTaskId = null) {
    const { start_date, end_date, start_time, end_time, task_name } = taskDetails;

    // Helper: Normalize date to YYYY-MM-DD string
    const toDateStr = (d) => new Date(d).toISOString().split('T')[0];

    const propStartStr = toDateStr(start_date);
    const propEndStr = end_date ? toDateStr(end_date) : propStartStr;
    const propIsLong = task_name === 'Date-Only / Long Task' || task_name === 'Long Task';

    // 1. Find existing non-rejected assignments
    const whereClause = {
        user_id: userId,
        status: { [Op.in]: ['accepted', 'completed', 'in_progress'] }
    };
    if (excludeTaskId) {
        whereClause.task_id = { [Op.ne]: excludeTaskId };
    }

    const existingAssignments = await TaskAssign.findAll({
        where: whereClause,
        include: [{
            model: Task,
            required: true,
            where: { is_deleted: false },
            include: [{
                model: TaskType,
                required: true
            }]
        }]
    });

    for (const existing of existingAssignments) {
        const exTask = existing.Task;
        const exType = exTask.TaskTypes?.[0];
        if (!exType) continue;

        const exIsLong = exType.task_name === 'Date-Only / Long Task' || exType.task_name === 'Long Task';
        const exStartStr = toDateStr(exType.start_date);
        const exEndStr = exType.end_date ? toDateStr(exType.end_date) : exStartStr;

        // A. Date Range Overlap Check
        // Two ranges [s1, e1] and [s2, e2] overlap if (s1 <= e2 && e1 >= s2)
        const datesOverlap = (propStartStr <= exEndStr && propEndStr >= exStartStr);

        if (datesOverlap) {
            // Case 1: Either is a Long Task (occupies entire day range)
            if (propIsLong || exIsLong) {
                return { 
                    hasConflict: true, 
                    conflictTask: { 
                        task_id: exTask.task_id, 
                        title: exTask.title,
                        reason: `Conflict with '${exTask.title}'. Long tasks occupy the entire day range (${exStartStr} to ${exEndStr}).`
                    } 
                };
            }

            // Case 2: Both are standard tasks. Check for time overlap on ANY overlapping date.
            // (Standard tasks usually don't span months, so we can iterate through the overlapping dates if it's just a few days)
            // But usually standard tasks are single-day or few-days.
            // If they share any date, and have overlapping times, it's a conflict.
            
            // Actually, we only care if they overlap in TIME.
            // If both have times set:
            if (exType.start_time && exType.end_time && start_time && end_time) {
                // Time overlap check: (s1 < e2 && e1 > s2)
                if (start_time < exType.end_time && end_time > exType.start_time) {
                    return { 
                        hasConflict: true, 
                        conflictTask: { 
                            task_id: exTask.task_id, 
                            title: exTask.title,
                            reason: `Time overlap with '${exTask.title}' (${exType.start_time} - ${exType.end_time}).`
                        } 
                    };
                }
            } else if (!exType.start_time || !start_time) {
                // If one doesn't have time but is NOT a long task, it might be a floating task or similar.
                // Usually, if it's not a long task, we assume it's okay unless times strictly overlap.
                // But if they share dates and one is "anytime", we might allow it.
                // Most standard tasks here seem to have times.
            }
        }
    }

    return { hasConflict: false, conflictTask: null };
}

module.exports = {
    checkTaskOverlap
};
