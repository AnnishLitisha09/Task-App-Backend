/**
 * Task Management Utility Functions
 */

const { Task, TaskAssign, User, Faculty, Student } = require('../models');
const { Op } = require('sequelize');

/**
 * Checks if a new task time range overlaps with any existing accepted/in-progress tasks for a user.
 * Supports priority overrides and Long Task pre-emption logic.
 * 
 * @param {number} userId - ID of the user
 * @param {object} taskDetails - { start_date, start_time, end_time, priority, task_name }
 * @param {number|string} excludeTaskId - Optional task ID to skip (usually the task being accepted)
 * @returns {Promise<object>} - { hasConflict, type, conflictTask, can_pause, reason }
 */
const checkTaskOverlap = async (userId, taskDetails, excludeTaskId = null) => {
    try {
        const { Task, TaskAssign, TaskType } = require('../models');
        const { Op } = require('sequelize');

        // Normalize inputs
        let { start_date, start_time, end_time, priority, task_name } = taskDetails;
        if (!start_date || !start_time || !end_time) {
            return { hasConflict: false };
        }

        // Convert Date object to string (YYYY-MM-DD) if needed
        const targetDateStr = (start_date instanceof Date) 
            ? start_date.toISOString().split('T')[0] 
            : new Date(start_date).toISOString().split('T')[0];

        const priorityLevels = { 'low': 1, 'medium': 2, 'high': 3, 'critical': 4 };
        const newPriorityVal = priorityLevels[priority?.toLowerCase()] || 1;

        // Fetch overlapping assignments for today
        const existingAssignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: { [Op.in]: ['accepted', 'in_progress', 'paused'] },
                task_id: excludeTaskId ? { [Op.ne]: excludeTaskId } : { [Op.ne]: null }
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    where: {
                        [Op.or]: [
                            { start_date: targetDateStr },
                            {
                                [Op.and]: [
                                    { start_date: { [Op.lte]: targetDateStr } },
                                    { end_date: { [Op.gte]: targetDateStr } }
                                ]
                            }
                        ]
                    }
                }]
            }]
        });

        for (const assign of existingAssignments) {
            const extTask = assign.Task;
            const extType = extTask.TaskTypes?.[0];
            if (!extType) continue;

            // ─── NEW: Check if the task actually occurs TODAY ───
            if (!isOccurrence(targetDateStr, extType.start_date, extType.end_date, extType.recurrence)) {
                continue; // Skip tasks that aren't occurring today
            }

            const isExtLong = extType.task_name === 'Long Task' || extType.task_name === 'Date-Only / Long Task';
            const isNewLong = task_name === 'Long Task' || task_name === 'Date-Only / Long Task';

            // Long Tasks (pre-emptible) have 8:45-16:30 default range for overlap checking
            const extStart = isExtLong ? '08:45:00' : extType.start_time;
            const extEnd = isExtLong ? '16:30:00' : extType.end_time;
            const newStart = isNewLong ? '08:45:00' : start_time;
            const newEnd = isNewLong ? '16:30:00' : end_time;

            // Basic overlap logic: (start1 < end2) AND (start2 < end1)
            if (newStart < extEnd && extStart < newEnd) {
                // Conflict detected!
                const extPriorityVal = priorityLevels[extTask.priority?.toLowerCase()] || 1;

                // Rule: If new task has HIGHER priority than existing task
                if (newPriorityVal > extPriorityVal) {
                    return {
                        hasConflict: true,
                        type: 'priority_override',
                        can_pause: isExtLong || isNewLong, // If one is flexible, it can be auto-paused/segmented
                        conflictTask: {
                            task_id: extTask.task_id,
                            title: extTask.title,
                            priority: extTask.priority
                        },
                        reason: `Priority override: ${priority} replaces ${extTask.priority}`
                    };
                } else if (isNewLong || isExtLong) {
                    // One is a long task, so it doesn't "block" hard, but we should notify if relevant
                    // Actually, for consistency, if priorities are equal/lower, we still flag conflict
                    // to prevent messy overlaps unless the user confirms.
                    return {
                        hasConflict: true,
                        type: 'time_conflict',
                        conflictTask: { task_id: extTask.task_id, title: extTask.title },
                        reason: `Overlap with existing ${extType.task_name}: ${extTask.title}`
                    };
                } else {
                    // Standard task vs Standard task (Equal or Higher Existing Priority)
                    return {
                        hasConflict: true,
                        type: 'blocked',
                        conflictTask: { task_id: extTask.task_id, title: extTask.title },
                        reason: `Tasks overlap and existing task has equal or higher priority.`
                    };
                }
            }
        }

        return { hasConflict: false };
    } catch (err) {
        console.error('[checkTaskOverlap Error]:', err);
        return { hasConflict: false }; // Fail safe to avoid blocking
    }
};

/**
 * Checks if current time is within official working hours (08:45 AM - 04:00 PM)
 * @returns {boolean}
 */
const isWithinWorkHours = () => {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const istOffset = 330 * 60 * 1000;
    const localNow = new Date(now.getTime() + istOffset);
    
    const hour = localNow.getUTCHours();
    const minute = localNow.getUTCMinutes();
    const totalMinutes = hour * 60 + minute;

    const startMinutes = 8 * 60 + 45; // 08:45
    const endMinutes = 16 * 60;      // 16:00
    
    return totalMinutes >= startMinutes && totalMinutes <= endMinutes;
};

/**
 * Calculates working minutes between two dates, excluding non-working hours
 * @param {Date} start 
 * @param {Date} end 
 * @returns {number}
 */
const getWorkingMinutes = (start, end) => {
    const startIST = new Date(start.getTime() + (330 * 60 * 1000));
    const endIST = new Date(end.getTime() + (330 * 60 * 1000));
    
    let totalMins = 0;
    let current = new Date(startIST);
    
    while (current < endIST) {
        const h = current.getUTCHours();
        const m = current.getUTCMinutes();
        const totalNow = h * 60 + m;
        
        // 08:45 to 16:00
        if (totalNow >= (8 * 60 + 45) && totalNow < (16 * 60)) {
            totalMins++;
        }
        current.setUTCMinutes(current.getUTCMinutes() + 1);
    }
    
    return totalMins;
};

/**
 * Resolves all escalations for a specific task once it's transferred or completed
 * @param {number} taskId 
 * @param {number} userId - The user who just acted (transferrer or completer)
 * @param {object} transaction - Optional sequelize transaction
 */
const resolveTaskEscalations = async (taskId, userId, transaction = null) => {
    try {
        const { TaskEscalation } = require('../models');
        
        // 1. Resolve pending escalations for this task/user
        await TaskEscalation.update(
            { status: 'resolved', resolved_at: new Date() },
            { 
                where: { task_id: taskId, user_id: userId, status: 'pending' },
                transaction 
            }
        );

        // 2. Check if there are any other PENDING escalations for this task (by other users)
        const anyEscalationsLeft = await TaskEscalation.findOne({
            where: { task_id: taskId, status: 'pending' },
            transaction
        });

        // 3. If no pending escalations left, clear the global flag on the Task
        if (!anyEscalationsLeft) {
            await Task.update({ is_escalate: false, status: 'Active' }, { 
                where: { task_id: taskId },
                transaction 
            });
        }
    } catch (err) {
        console.error(`[resolveTaskEscalations Error] Task ${taskId}, User ${userId}:`, err);
    }
};

/**
 * Converts a date to IST Date String (YYYY-MM-DD)
 * @param {Date|string} d 
 * @returns {string}
 */
const toISTDateStr = (d) => {
    if (!d) return null;
    return new Date(new Date(d).getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];
};

/**
 * Checks if a task occurs on a specific target date based on its schedule and recurrence
 * @param {string} targetDateStr - YYYY-MM-DD
 * @param {Date|string} tStart - Task start date
 * @param {Date|string} tEnd - Task end date (optional)
 * @param {string} recurrence - none, daily, weekly, monthly
 * @returns {boolean}
 */
const isOccurrence = (targetDateStr, tStart, tEnd, recurrence) => {
    const startStr = toISTDateStr(tStart);
    const endStr = toISTDateStr(tEnd);

    if (targetDateStr < startStr) return false;
    if (endStr && targetDateStr > endStr) return false;

    if (recurrence === 'none' || !recurrence) return targetDateStr === startStr;
    if (recurrence === 'daily') return true;

    const targetDate = new Date(`${targetDateStr}T00:00:00`);
    const startDate = new Date(`${startStr}T00:00:00`);

    if (recurrence === 'weekly') return targetDate.getDay() === startDate.getDay();
    if (recurrence === 'monthly') return targetDate.getDate() === startDate.getDate();
    return false;
};

/**
 * Automatically adjusts the status (pause/resume) of a user's Long Tasks
 * based on whether they have other active (In Progress/Accepted) fixed-time tasks.
 * @param {number} userId 
 * @param {object} transaction - Optional sequelize transaction
 */
const adjustLongTaskStatus = async (userId, transaction = null) => {
    try {
        const { Task, TaskAssign, TaskType } = require('../models');
        const { Op } = require('sequelize');

        // Today's Date String
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // 1. Find the current EXCLUSIVE active task (if any)
        // A task is 'exclusive active' if it's currently In Progress.
        const inProgressTask = await TaskAssign.findOne({
            where: { user_id: userId, status: 'in_progress' },
            include: [{ model: Task, include: [TaskType] }],
            transaction
        });

        // 2. Find all Fixed-Time tasks that are 'Accepted' and scheduled for RIGHT NOW
        // (This helps preemptively pause long tasks even if the user hasn't pressed 'Start' yet)
        const activeFixedTasks = await TaskAssign.findAll({
            where: { user_id: userId, status: 'accepted' },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        task_name: { [Op.notIn]: ['Long Task', 'Date-Only / Long Task'] },
                        [Op.or]: [
                            { start_date: dateStr },
                            {
                                [Op.and]: [
                                    { start_date: { [Op.lte]: dateStr } },
                                    { end_date: { [Op.gte]: dateStr } }
                                ]
                            }
                        ]
                    }
                }]
            }],
            transaction
        });

        // Does the user have a scheduled fixed task right now?
        const hasScheduledFixedTask = activeFixedTasks.some(a => {
            const tt = a.Task.TaskTypes[0];
            if (!tt.start_time || !tt.end_time) return false;
            const nowTime = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}:00`;
            return nowTime >= tt.start_time && nowTime <= tt.end_time;
        });

        // 3. Find all Long Tasks assignments
        const longTaskAssignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: { [Op.in]: ['accepted', 'in_progress', 'paused'] }
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true,
                    where: { task_name: { [Op.in]: ['Long Task', 'Date-Only / Long Task'] } }
                }]
            }],
            transaction
        });

        // Logic:
        // - If ANY task is In Progress -> Pause all OTHER long tasks.
        // - If a Fixed Task is scheduled for NOW -> Pause all long tasks.
        // - If NOTHING is In Progress and NO Fixed Task is scheduled -> Resume the 'latest' long task.

        const shouldPauseAllLong = !!inProgressTask || hasScheduledFixedTask;

        for (const la of longTaskAssignments) {
            // Skip the one that is currently in_progress if we are NOT pausing all
            if (inProgressTask && la.task_id === inProgressTask.task_id) continue;

            if (shouldPauseAllLong) {
                // Pause it
                if (la.status !== 'paused') {
                    await la.update({ status: 'paused' }, { transaction });
                    await Task.update({ is_paused: true, status: 'PAUSED' }, { where: { task_id: la.task_id }, transaction });
                }
            }
        }

        // Auto-Resume logic: If NOTHING is active, resume the most recently accepted/started Long Task
        if (!shouldPauseAllLong && longTaskAssignments.length > 0) {
            // Find the best one to resume (e.g., the one with status 'paused' that was most recently accepted)
            const toResume = longTaskAssignments
                .filter(a => a.status === 'paused')
                .sort((a, b) => new Date(b.accepted_at) - new Date(a.accepted_at))[0];

            if (toResume) {
                await toResume.update({ status: 'in_progress' }, { transaction });
                await Task.update({ is_paused: false, status: 'RESUMED' }, { where: { task_id: toResume.task_id }, transaction });
            }
        }
    } catch (err) {
        console.error(`[adjustLongTaskStatus Error] User ${userId}:`, err);
    }
};

module.exports = { 
    checkTaskOverlap, 
    isWithinWorkHours, 
    getWorkingMinutes, 
    resolveTaskEscalations, 
    toISTDateStr, 
    isOccurrence,
    adjustLongTaskStatus
};