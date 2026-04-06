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
        let { start_date, start_time, end_time, priority, task_name, origin_type } = taskDetails;
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
                
                // ─── NEW: Long Tasks Bypass Conflict Checking ───
                // Two Long Tasks CANNOT overlap!
                if (isNewLong && isExtLong) {
                    return {
                        hasConflict: true,
                        type: 'time_conflict',
                        conflictTask: { task_id: extTask.task_id, title: extTask.title },
                        reason: `Multiple Long Tasks cannot be scheduled simultaneously. This overlaps with: ${extTask.title}`
                    };
                }

                // But a Long task and a Fixed task can overlap freely (they pause/resume dynamically)
                if (isNewLong || isExtLong) {
                    continue; // Skip conflict generation for this pair
                }

                // ─── NEW: Strict Overlap for Self-Log and Directive ───
                const isNewStrict = (origin_type === 'self-log' || origin_type === 'directive');
                const isExtStrict = (extTask.origin_type === 'self-log' || extTask.origin_type === 'directive');

                if (isNewStrict && isExtStrict) {
                    return {
                        hasConflict: true,
                        type: 'strict_overlap',
                        conflictTask: {
                            task_id: extTask.task_id,
                            title: extTask.title,
                            origin_type: extTask.origin_type
                        },
                        reason: `Overlap not allowed between ${origin_type} and ${extTask.origin_type}.`
                    };
                }

                const extPriorityVal = priorityLevels[extTask.priority?.toLowerCase()] || 1;
                const isNewMandatory = taskDetails.is_mandatory || false;
                const isExtMandatory = extTask.is_mandatory || false;

                // Priority Check
                let shouldOverride = false;
                let reason = "";

                if (newPriorityVal > extPriorityVal) {
                    shouldOverride = true;
                    reason = `Priority override: ${priority} replaces ${extTask.priority}`;
                } else if (newPriorityVal === extPriorityVal) {
                    // Tie-break 1: Mandatory status
                    if (isNewMandatory && !isExtMandatory) {
                        shouldOverride = true;
                        reason = "Mandatory task takes precedence over non-mandatory task of equal priority.";
                    } else if (isNewMandatory === isExtMandatory) {
                        // Tie-break 2: Start Time (Earlier wins)
                        if (newStart < extStart) {
                            shouldOverride = true;
                            reason = "Earlier scheduled task takes precedence among equal priority/mandatory status.";
                        } else if (newStart === extStart) {
                            // Tie-break 3: Creation Order (Newer wins - assuming latest assignment is most relevant)
                            if (extTask.task_id < (taskDetails.task_id || 999999)) {
                                shouldOverride = true;
                                reason = "Latest assigned task takes precedence among identical schedules.";
                            }
                        }
                    }
                }

                if (shouldOverride) {
                    return {
                        hasConflict: true,
                        type: 'priority_override',
                        can_pause: isExtLong || isNewLong || isExtMandatory || isNewMandatory, // Allow pre-emption if mandatory or flexible
                        conflictTask: {
                            task_id: extTask.task_id,
                            title: extTask.title,
                            priority: extTask.priority
                        },
                        reason: reason
                    };
                } else {
                    // Standard task vs Standard task (Existing task wins tie or has higher priority)
                    return {
                        hasConflict: true,
                        type: 'blocked',
                        conflictTask: { task_id: extTask.task_id, title: extTask.title },
                        reason: `Overlap with existing task: ${extTask.title}. Existing task has higher or equal precedence.`
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
 * Checks if provided task times are within official working hours (08:45 AM - 04:30 PM)
 * Rule 6: Only critical tasks can be scheduled outside these hours.
 * @param {string} startTime - HH:mm:ss
 * @param {string} endTime - HH:mm:ss
 * @param {string} priority - low, medium, high, critical
 * @returns {object} - { isWithin, reason }
 */
const isWithinWorkHours = (startTime, endTime, priority = 'low') => {
    if (priority?.toLowerCase() === 'critical') {
        return { isWithin: true };
    }

    if (!startTime || !endTime) return { isWithin: true };

    const toMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
    };

    const taskStart = toMinutes(startTime);
    const taskEnd = toMinutes(endTime);
    const workStart = 8 * 60 + 45; // 08:45
    const workEnd = 16 * 60 + 30;  // 16:30 (04:30 PM)

    if (taskStart < workStart || taskEnd > workEnd) {
        return {
            isWithin: false,
            reason: `Task time (${startTime} - ${endTime}) is outside official working hours (08:45 AM - 04:30 PM). Only critical tasks are allowed outside these hours.`
        };
    }

    return { isWithin: true };
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
        
        // 08:45 to 16:30
        if (totalNow >= (8 * 60 + 45) && totalNow < (16 * 60 + 30)) {
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
        
        // 1. Resolve ALL pending escalations for this task
        // When a manager/creator take action, we resolve the entire task's escalation state
        await TaskEscalation.update(
            { status: 'resolved', resolved_at: new Date() },
            { 
                where: { task_id: taskId, status: 'pending' },
                transaction 
            }
        );

        // 2. Clear the global flag on the Task
        await Task.update({ is_escalate: false, status: 'Active', stage: 'Active' }, { 
            where: { task_id: taskId },
            transaction 
        });
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
            
            // Check if this recurrence/date actually applies today
            if (!isOccurrence(dateStr, tt.start_date, tt.end_date, tt.recurrence)) return false;

            const nowTime = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}:00`;
            return nowTime >= tt.start_time && nowTime <= tt.end_time;
        });

        // 3. Find all Long Tasks assignments for TODAY
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
                    where: { 
                        task_name: { [Op.in]: ['Long Task', 'Date-Only / Long Task'] },
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

        // Logic:
        // - If ANY task is In Progress -> Pause all OTHER long tasks.
        // - If a Fixed Task (inc. Recurring) is scheduled for NOW -> Pause all long tasks.
        // - If NOTHING is In Progress and NO Fixed Task is scheduled -> Resume the 'latest' long task.

        const shouldPauseAllLong = !!inProgressTask || hasScheduledFixedTask;

        for (const la of longTaskAssignments) {
            // Skip the one that is currently in_progress if we are NOT pausing all
            const isSelfInProgress = inProgressTask && la.task_id === inProgressTask.task_id;

            if (shouldPauseAllLong) {
                // Pause it (unless it's a fixed task that IS the inProgressTask, which longTaskAssignments filters out anyway by task_name)
                if (la.status !== 'paused' && !isSelfInProgress) {
                    await la.update({ status: 'paused' }, { transaction });
                    await Task.update({ is_paused: true, status: 'PAUSED' }, { where: { task_id: la.task_id }, transaction });
                }
            } else if (isSelfInProgress) {
                // If it should NOT be paused but it is in_progress, ensure it stays that way
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

/**
 * Unified notification creator that handles venue-specific prefixing.
 */
async function createNotification({ userId, title, msg, type = 'general', venueId = null, transaction = null }) {
    const { Notification } = require('../models');
    
    let finalTitle = title;
    if (venueId) {
        finalTitle = `[V:${venueId}] ${title}`;
    }

    return await Notification.create({
        user_id: userId,
        title: finalTitle,
        msg,
        type
    }, { transaction });
}

/**
 * Checks if an escalated task is scheduled for a future time.
 * @param {number} taskId 
 * @returns {Promise<boolean>}
 */
const isEscalatedTaskFuture = async (taskId) => {
    const { Task, TaskType } = require('../models');
    const task = await Task.findByPk(taskId, { include: [TaskType] });
    if (!task) return true;

    const isEscalated = task.status?.toLowerCase() === 'escalated' || task.is_escalate;
    if (!isEscalated) return true;

    if (task.TaskTypes && task.TaskTypes.length > 0) {
        const tt = task.TaskTypes[0];
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        // Local now in IST
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        // Deadline check
        const dateStr = tt.end_date ? new Date(tt.end_date).toISOString().split('T')[0] : new Date(tt.start_date).toISOString().split('T')[0];
        const timeStr = tt.end_time || '23:59:59';
        const deadline = new Date(`${dateStr}T${timeStr}`);

        return deadline > localNow;
    }
    return true;
};

/**
 * Automatically cleans up student tasks that have failed their compliance windows:
 * 1. Proof Submission: Marked "not_completed" and "Inactive" after 6 working hours.
 * 2. OTP/End Activity: Marked "not_completed" after 12:00 AM of the next day.
 */
const cleanupStudentTasks = async (userId, transaction = null) => {
    try {
        const { Task, TaskAssign, TaskType, TaskLog } = require('../models');
        const { Op } = require('sequelize');

        // Today's date in IST
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const todayStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Fetch active assignments for the student
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: { [Op.in]: ['accepted', 'in_progress'] } },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType, required: true }]
            }],
            transaction
        });

        for (const a of assignments) {
            const task = a.Task;
            const tt = task.TaskTypes?.[0];
            if (!tt) continue;

            const isLongTask = tt.task_name === 'Date-Only / Long Task' || tt.task_name === 'Long Task';
            const taskEndStr = toISTDateStr(tt.end_date || tt.start_date);
            const taskEndTime = isLongTask ? '16:30:00' : tt.end_time;
            if (!taskEndTime) continue;

            const endDateTime = new Date(`${taskEndStr}T${taskEndTime}`);
            
            // Check Rule 1: Proof Submission (6 Working Hours)
            if (task.is_document) {
                // If end time has passed
                if (localNow > endDateTime) {
                    const elapsedWorkingMins = getWorkingMinutes(endDateTime, localNow);
                    if (elapsedWorkingMins >= (6 * 60)) {
                        // Mark as not submitted and inactive
                        await a.update({ status: 'not_completed', reason: 'Proof Submission Timeout (6 Working Hours)' }, { transaction });
                        // Also mark the task as inactive globally
                        await Task.update({ status: 'Inactive' }, { where: { task_id: task.task_id }, transaction });
                        
                        await TaskLog.create({
                            task_id: task.task_id,
                            user_id: userId,
                            action: 'auto_inactive',
                            details: `Task marked Inactive/Not Submitted: 6 working hours passed since deadline without proof.`
                        }, { transaction });
                        continue;
                    }
                }
            } else {
                // Check Rule 2: OTP / End Activity (End of day)
                // If it's strictly the next day
                if (todayStr > taskEndStr) {
                    await a.update({ status: 'not_completed', reason: 'End Activity Timeout (Next Day reached)' }, { transaction });
                    await TaskLog.create({
                        task_id: task.task_id,
                        user_id: userId,
                        action: 'auto_incomplete',
                        details: `Task marked incomplete: Next day reached before activity was ended via OTP.`
                    }, { transaction });
                }
            }
        }
    } catch (err) {
        console.error(`[cleanupStudentTasks Error] User ${userId}:`, err);
    }
};

/**
 * Synchronizes a user's profile score and penalty with their completed tasks.
 */
const syncUserScore = async (userId, userRole, transaction = null) => {
    try {
        const { TaskAssign, Student, Faculty, Staff, RoleUser, Task } = require('../models');
        const { Op } = require('sequelize');

        // Sum earned scores and penalties
        const stats = await TaskAssign.findAll({
            where: { user_id: userId, status: 'completed' },
            attributes: [
                [require('sequelize').fn('SUM', require('sequelize').col('earned_score')), 'total_earned'],
                [require('sequelize').fn('SUM', require('sequelize').col('penalty_applied')), 'total_penalty']
            ],
            raw: true,
            transaction
        });

        const earnedSum = parseFloat(stats[0]?.total_earned || 0);
        const penaltySum = parseFloat(stats[0]?.total_penalty || 0);
        const totalGross = earnedSum + penaltySum;

        // Update all discovery-based profiles for this user
        const profileModels = [Student, Faculty, Staff, RoleUser];
        const updateData = { score: earnedSum, penalty: penaltySum, total_score: totalGross };
        
        let updatedCount = 0;
        for (const Model of profileModels) {
            const p = await Model.findOne({ where: { user_id: userId }, transaction });
            if (p) {
                await p.update(updateData, { transaction });
                updatedCount++;
            }
        }

        return { ...updateData, updatedCount };
    } catch (err) {
        console.error(`[syncUserScore Error] User ${userId}:`, err);
        return null;
    }
};

module.exports = { 
    checkTaskOverlap, 
    isWithinWorkHours, 
    getWorkingMinutes, 
    resolveTaskEscalations, 
    toISTDateStr, 
    isOccurrence,
    adjustLongTaskStatus,
    cleanupStudentTasks,
    syncUserScore,
    createNotification,
    isEscalatedTaskFuture
};