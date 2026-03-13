const { Task, TaskType, TaskAssign } = require('../models');
const { Op } = require('sequelize');

/**
 * Checks if a proposed task overlaps with any existing 'accepted', 'completed', or 'in_progress' tasks for a user.
 * @param {number} userId - ID of the user to check conflicts for.
 * @param {object} taskDetails - Details of the proposed task: { start_date, end_date, start_time, end_time, task_name }
 * @param {number} [excludeTaskId] - Optional ID to exclude from checks (useful for updates).
 * @returns {Promise<object>} - { hasConflict: boolean, conflictTask: object | null }
 */
const { PRIORITY_WEIGHTS, BUFFER_MINUTES, WORK_START, WORK_END } = require('../config/constants');

/**
 * Checks if given times are within allowed work hours.
 */
function isWithinWorkHours(startTime, endTime, priority = 'low') {
    if (!startTime || !endTime) return { isWithin: true }; // Can't validate without times

    const parseTime = (t) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };

    if (priority === 'critical') return { isWithin: true };

    const startMin = parseTime(startTime);
    const endMin = parseTime(endTime);
    const workStartMin = parseTime(WORK_START);
    const workEndMin = parseTime(WORK_END);

    if (startMin < workStartMin || endMin > workEndMin) {
        return {
            isWithin: false,
            reason: `Tasks must be within work hours (${WORK_START} - ${WORK_END}).`
        };
    }

    return { isWithin: true };
}

/**
 * Checks if a proposed task overlaps with any existing 'accepted', 'completed', or 'in_progress' tasks for a user.
 * Now includes priority awareness, time buffers, and work hour validation.
 */
async function checkTaskOverlap(userId, taskDetails, excludeTaskId = null) {
    const { start_date, end_date, start_time, end_time, task_name, priority = 'low' } = taskDetails;

    const toDateStr = (d) => {
        if (!d) return null;
        return new Date(new Date(d).getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];
    };
    const parseTime = (t) => {
        if (!t) return null;
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };

    // 0. Work Hour Validation
    const workHourCheck = isWithinWorkHours(start_time, end_time, priority);
    if (!workHourCheck.isWithin) {
        return {
            hasConflict: true,
            type: 'work_hours',
            reason: workHourCheck.reason
        };
    }

    const propStartStr = toDateStr(start_date);
    const propEndStr = end_date ? toDateStr(end_date) : propStartStr;
    const propIsLong = task_name === 'Date-Only / Long Task' || task_name === 'Long Task';
    const propWeight = PRIORITY_WEIGHTS[priority] || 0;

    const whereClause = {
        user_id: userId,
        status: { [Op.in]: ['accepted', 'in_progress'] } // Exclude 'completed' per new rule
    };
    if (excludeTaskId) whereClause.task_id = { [Op.ne]: excludeTaskId };

    const existingAssignments = await TaskAssign.findAll({
        where: whereClause,
        include: [{
            model: Task,
            required: true,
            where: { is_deleted: false },
            include: [{ model: TaskType, required: true }]
        }]
    });

    for (const existing of existingAssignments) {
        const exTask = existing.Task;
        const exType = exTask.TaskTypes?.[0];
        if (!exType) continue;

        const exIsLong = exType.task_name === 'Date-Only / Long Task' || exType.task_name === 'Long Task';
        const exStartStr = toDateStr(exType.start_date);
        const exEndStr = exType.end_date ? toDateStr(exType.end_date) : exStartStr;
        const exWeight = PRIORITY_WEIGHTS[exTask.priority] || 0;

        // Date Range Overlap Check
        const datesOverlap = (propStartStr <= exEndStr && propEndStr >= exStartStr);
        if (!datesOverlap) continue;

        // Case 1: Long Task Conflict
        if (propIsLong || exIsLong) {
            // Long tasks are "background", can be paused if higher priority comes in
            if (propWeight > exWeight) {
                // Return potential for pause/override
                return { 
                    hasConflict: true, 
                    type: 'priority_override',
                    can_pause: exIsLong,
                    conflictTask: { task_id: exTask.task_id, title: exTask.title, priority: exTask.priority, weight: exWeight }
                };
            } else {
                return { 
                    hasConflict: true, 
                    type: 'blocked',
                    reason: `Blocked by ${exIsLong ? 'Long Task' : 'High Priority'} "${exTask.title}".`
                };
            }
        }

        // Case 2: Standard Time Overlap with 5-min Buffer
        if (exType.start_time && exType.end_time && start_time && end_time) {
            const s1 = parseTime(start_time);
            const e1 = parseTime(end_time);
            const s2 = parseTime(exType.start_time);
            const e2 = parseTime(exType.end_time);

            // Check overlap with buffer: (s1 < e2 + buffer && e1 > s2 - buffer)
            if (s1 < (e2 + BUFFER_MINUTES) && e1 > (s2 - BUFFER_MINUTES)) {
                if (propWeight > exWeight) {
                    return { 
                        hasConflict: true, 
                        type: 'priority_override',
                        conflictTask: { task_id: exTask.task_id, title: exTask.title, priority: exTask.priority, weight: exWeight }
                    };
                } else {
                    return { 
                        hasConflict: true, 
                        type: 'blocked',
                        reason: `Time overlap (with ${BUFFER_MINUTES}m buffer) with "${exTask.title}".`
                    };
                }
            }
        }
    }

    return { hasConflict: false };
}

module.exports = { checkTaskOverlap, isWithinWorkHours };
