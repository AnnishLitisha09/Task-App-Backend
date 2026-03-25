const cron = require('node-cron');
const { User, Task, TaskAssign, TaskType, TaskEscalation, Notification, TaskLog } = require('../models');
const { Op } = require('sequelize');
const { getWorkingMinutes } = require('../utils/task-utils');
const { getSupervisor } = require('../utils/hierarchy');

let isProcessingEscalations = false;

/**
 * Main Escalation Engine
 * Checks for:
 * 1. Unaccepted Tasks (Still pending after start time)
 * 2. Overdue Tasks (Not completed 1 hour after end time)
 */
const processAllEscalations = async () => {
    if (isProcessingEscalations) {
        console.log('[CRON] Escalation Engine already running, skipping this minute');
        return;
    }
    isProcessingEscalations = true;
    try {
        // if (new Date().getDay() === 0) return; // Skip Sunday (TEMPORARILY DISABLED FOR TESTING)

        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const todayStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
        const localTimeStr = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}:00`;

        console.log(`[CRON] Escalation Engine Running at ${localTimeStr}`);

        const supervisorCache = {}; // Cache to avoid N+1 queries during this run

        // Trigger 1: UNACCEPTED tasks (status 'pending' and start_time passed)
        const unaccepted = await TaskAssign.findAll({
            where: { status: 'pending' },
            include: [
                {
                    model: Task,
                    where: { is_deleted: false },
                    include: [{ model: TaskType }]
                },
                { model: User, attributes: ['user_id', 'role'] }
            ]
        });

        for (const a of unaccepted) {
            const tt = a.Task?.TaskTypes?.[0];
            if (!tt) continue;

            const taskStartStr = new Date(tt.start_date).toISOString().split('T')[0];
            const taskStartTime = tt.start_time;

            if (taskStartStr < todayStr || (taskStartStr === todayStr && localTimeStr > taskStartTime)) {
                // STUDENT CHECK: Students are marked as rejected instead of escalated
                const user = a.User;
                if (user && user.role && user.role.toLowerCase() === 'student') {
                    await a.update({ status: 'rejected', reason: 'Not Accepted by Start Time' });
                    // Even if we don't create a formal TaskEscalation record for students, 
                    // we must mark the task as escalated so the manager can "Execute Directive"
                    await Task.update({ is_escalate: true, stage: 'escalated' }, { where: { task_id: a.task_id } });
                    
                    await TaskLog.create({
                        task_id: a.task_id,
                        user_id: a.user_id,
                        action: 'unaccepted_auto_reject',
                        details: `Student task auto-rejected: Not accepted by start time.`
                    });
                    continue;
                }

                await escalateAssignment(a, 'Task Not Accepted by Start Time', supervisorCache);
                continue;
            }

            // --- 6 working hours acceptance rule for non-students ---
            const user = a.User;
            if (user && user.role && user.role.toLowerCase() !== 'student') {
                const assignedAt = new Date(a.created_at); // Assignment time
                const istAssignedAt = new Date(assignedAt.getTime() + (assignedAt.getTimezoneOffset() * 60000) + istOffset);
                
                const elapsedWorkingMins = getWorkingMinutes(istAssignedAt, localNow);
                const SIX_HOURS_IN_MINS = 6 * 60;
                
                if (elapsedWorkingMins >= SIX_HOURS_IN_MINS) {
                    await escalateAssignment(a, 'Task Not Accepted within 6 Working Hours (8:45 AM - 4:00 PM)', supervisorCache);
                }
            }
        }

        // Trigger 2: OVERDUE tasks
        const ongoing = await TaskAssign.findAll({
            where: { status: { [Op.in]: ['accepted', 'in_progress'] } },
            include: [
                {
                    model: Task,
                    where: { is_deleted: false },
                    include: [
                        { model: TaskType },
                        { model: TaskAssign, attributes: ['id'] } // NEW: to check single vs multiple assignees
                    ]
                },
                { model: User, attributes: ['user_id', 'role'] }
            ]
        });

        for (const a of ongoing) {
            const tt = a.Task?.TaskTypes?.[0];
            if (!tt) continue;

            const isLongTask = tt.task_name === 'Date-Only / Long Task' || tt.task_name === 'Long Task';
            const taskEndStr = new Date(tt.end_date || tt.start_date).toISOString().split('T')[0];
            const taskEndTime = isLongTask ? '16:30:00' : tt.end_time;
            if (!taskEndTime) continue;

            // Check if single person assignment
            const assigneeCount = a.Task?.TaskAssigns?.length || 0;
            const isSinglePerson = assigneeCount === 1;

            // Student Check: No escalation at 1 hour for students
            const user = a.User;
            const isStudent = user && user.role && user.role.toLowerCase() === 'student';

            // Standard Overdue Check (Non-Students)
            if (!isStudent) {
                const isDocumentRequired = a.Task?.is_document;
                const endDateTime = new Date(`${taskEndStr}T${taskEndTime}`);
                const elapsedWorkingMins = getWorkingMinutes(endDateTime, localNow);

                if (localNow > endDateTime) {
                    console.log(`[DEBUG] Task ${a.task_id} is OVERDUE. localNow: ${localNow.toISOString()}, endDateTime: ${endDateTime.toISOString()}`);
                    if (isDocumentRequired) {
                        // Rule: 6 working hours for proof submission
                        if (elapsedWorkingMins >= (6 * 60)) {
                            console.log(`[DEBUG] Task ${a.task_id} escalating due to Document Timeout`);
                            await escalateAssignment(a, 'Proof Submission Deadline Expired (6 Working Hours)', supervisorCache);
                            continue;
                        }
                    } else {
                        // Standard: Check for buffer
                        const [h, m] = taskEndTime.split(':').map(Number);
                        
                        // NEW: Single person task escalates IMMEDIATELY (no buffer)
                        // Multiple person tasks still get 1 hour buffer
                        const bufferMinutes = isSinglePerson ? 0 : 60;
                        const endMinutesWithBuffer = h * 60 + m + bufferMinutes; 
                        
                        const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();
                        console.log(`[DEBUG] Task ${a.task_id} buffer check: currentMinutes: ${currentMinutes}, endMinutesWithBuffer: ${endMinutesWithBuffer}, isSinglePerson: ${isSinglePerson}`);

                        if (taskEndStr < todayStr || (taskEndStr === todayStr && currentMinutes > endMinutesWithBuffer)) {
                            const reason = isSinglePerson 
                                ? 'Task Overdue (Immediate escalation for single assignee)' 
                                : 'Task Overdue (Not completed 1 hour after end time)';
                            console.log(`[DEBUG] Task ${a.task_id} escalating due to Standard Timeout: ${reason}`);
                            await escalateAssignment(a, reason, supervisorCache);
                            continue;
                        }
                    }
                } else {
                    console.log(`[DEBUG] Task ${a.task_id} NOT overdue yet. localNow: ${localNow.toISOString()}, endDateTime: ${endDateTime.toISOString()}`);
                }
            }

            // NEW: 24-Hour No Proof Logic for Students
            if (isStudent) {
                const endDateTime = new Date(`${taskEndStr}T${taskEndTime}`);
                const diffMs = localNow - endDateTime;
                const diffHours = diffMs / (1000 * 60 * 60);

                if (diffHours >= 24) {
                    await a.update({ status: 'not_completed', reason: 'No proof submitted within 24 hours' });
                    await TaskLog.create({
                        task_id: a.task_id,
                        user_id: a.user_id,
                        action: 'auto_not_completed',
                        details: `Student task marked not_completed: No submission within 24 hours of end time.`
                    });
                }
            }
        }


        // Trigger 4: UNIVERSAL Man-Time TIMEOUT (max_duration_hours in working hours)
        const tasksWithTimeout = await TaskAssign.findAll({
            where: { status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } },
            include: [
                {
                    model: Task,
                    where: { is_deleted: false },
                    include: [{ 
                        model: TaskType,
                        where: { max_duration_hours: { [Op.ne]: null } }
                    }]
                },
                { model: User, attributes: ['user_id', 'role'] }
            ]
        });

        for (const a of tasksWithTimeout) {
            const tt = a.Task?.TaskTypes?.[0];
            if (!tt || !tt.max_duration_hours) continue;

            const user = a.User;
            const isStudent = user && user.role && user.role.toLowerCase() === 'student';

            // Start time for timeout calculation:
            // If pending: use assignment creation/update time
            // If accepted/in_progress: use accepted_at time
            const startTime = (a.status === 'pending') ? new Date(a.updated_at) : (a.accepted_at ? new Date(a.accepted_at) : new Date(a.created_at));
            const istStartTime = new Date(startTime.getTime() + (startTime.getTimezoneOffset() * 60000) + istOffset);
            
            const elapsedWorkingMins = getWorkingMinutes(istStartTime, localNow);
            const maxMins = parseFloat(tt.max_duration_hours) * 60;

            if (elapsedWorkingMins > maxMins) {
                // Escalate directly to CREATOR as requested by the user
                const reason = `Man-Time timeout: Exceeded ${tt.max_duration_hours} working hours (${a.status})`;
                console.log(`[ESCALATION] Task ${a.task_id} User ${a.user_id} TIMEOUT. Elapsed: ${elapsedWorkingMins}m, Max: ${maxMins}m. Escalating to Creator: ${a.Task.creator_id}`);
                await escalateAssignment(a, reason, supervisorCache, a.Task.creator_id);
            }
        }

        // Trigger 3: Priority Override Timeout
        const { ESCALATION_WINDOW_END } = require('../config/constants');
        const [escH, escM] = ESCALATION_WINDOW_END.split(':').map(Number);
        
        if (localNow.getHours() > escH || (localNow.getHours() === escH && localNow.getMinutes() >= escM)) {
            const pendingOverrides = await TaskEscalation.findAll({
                where: {
                    reason: { [Op.like]: '%Priority Override Requested%' },
                    status: 'pending',
                    created_at: { [Op.lt]: new Date(todayStr + ' 00:00:00') }
                }
            });

            for (const esc of pendingOverrides) {
                await esc.update({ status: 'escalated', msg: esc.msg + ' [AUTO-ESCALATED after morning deadline]' });
                await Notification.create({
                    user_id: 1, // Admin
                    title: 'Priority Override Escalation',
                    msg: `URGENT: Override request for Task ${esc.task_id} timeout. Decision required.`,
                    type: 'task_escalation'
                });
            }
        }

    } catch (error) {
        console.error('[CRON ERROR] Escalation Engine:', error);
    } finally {
        isProcessingEscalations = false;
    }
};

/**
 * Internal helper to handle the escalation of a single assignment
 */
const escalateAssignment = async (assign, reason, cache = null, forcedSupervisorId = null) => {
    try {
        const supervisorId = forcedSupervisorId || await getSupervisor(assign.user_id, cache);
        if (!supervisorId) return;

        // 1. Move status to escalated
        await assign.update({ status: 'escalated' });
        await Task.update({ is_escalate: true, stage: 'escalated' }, { where: { task_id: assign.task_id } });

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

        // 5. Notify Creator (if different from Supervisor)
        const taskCreatorId = assign.Task?.creator_id;
        if (taskCreatorId && taskCreatorId !== supervisorId) {
            await Notification.create({
                user_id: taskCreatorId,
                title: 'Task Escalation Notification',
                msg: `Notice: Task "${assign.Task.title}" assigned to User ${assign.user_id} has been escalated. Reason: ${reason}`,
                type: 'task_escalation'
            });
        }

        console.log(`[ESCALATION] Task ${assign.task_id} for User ${assign.user_id} escalated to Supervisor ${supervisorId}`);
    } catch (err) {
        console.error(`Error escalating assignment ${assign.id}:`, err);
    }
};

// Schedule: Every minute
cron.schedule('* * * * *', processAllEscalations);

module.exports = { processAllEscalations, getWorkingMinutes };
