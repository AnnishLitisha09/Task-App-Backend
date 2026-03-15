const { Task, TaskAssign, TaskType, User, TaskEscalation, Notification, Faculty, TaskLog, Student, Staff, RoleUser, TaskApprovalRequest } = require('../models');

// Accept assigned task
exports.acceptTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;
        const { Op } = require('sequelize');

        // 1. Find assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId },
            include: [{ model: Task, include: [{ model: TaskType }] }]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Task assignment not found' });
        }

        // Check if already processed
        if (assignment.status !== 'pending') {
            return res.status(400).json({
                message: `Task already ${assignment.status}`
            });
        }

        const taskType = assignment.Task?.TaskTypes?.[0];
        if (!taskType) {
            return res.status(400).json({ message: 'Task schedule details not found' });
        }

        // --- NEW: 7:00 PM Visibility Rule for Students ---
        // Verify user role
        const user = await User.findByPk(userId);
        if (user && user.role && user.role.toLowerCase() === 'student') {
            if (taskType.start_date) {
                const now = new Date();
                const istOffset = 5.5 * 60 * 60 * 1000;
                const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
                
                // Get local date string YYYY-MM-DD
                const year = localNow.getFullYear();
                const month = String(localNow.getMonth() + 1).padStart(2, '0');
                const day = String(localNow.getDate()).padStart(2, '0');
                const localDateStr = `${year}-${month}-${day}`;

                const taskDateStr = new Date(taskType.start_date).toISOString().split('T')[0];

                if (taskDateStr > localDateStr) {
                    // Task is for a future date. Check if it's tomorrow OR if it's Monday and today is Saturday
                    const localTomorrow = new Date(localNow);
                    localTomorrow.setDate(localTomorrow.getDate() + 1);
                    const localTomorrowStr = localTomorrow.toISOString().split('T')[0];

                    const localMonday = new Date(localNow);
                    const daysUntilMonday = (8 - localNow.getDay()) % 7 || 7; // If today is Sat (6), daysRef = 2
                    localMonday.setDate(localNow.getDate() + daysUntilMonday);
                    const localMondayStr = localMonday.toISOString().split('T')[0];

                    const isTomorrow = (taskDateStr === localTomorrowStr);
                    const isSaturdayToMonday = (localNow.getDay() === 6 && taskDateStr === localMondayStr);

                    if (isTomorrow || isSaturdayToMonday) {
                        if (localNow.getHours() < 19) {
                            return res.status(403).json({
                                message: 'Task Not Yet Available',
                                details: isSaturdayToMonday 
                                    ? 'Monday tasks only become available on Saturday after 07:00 PM.'
                                    : 'Task only becomes available after 07:00 PM today.'
                            });
                        }
                    } else {
                        // Task is for a date even further in the future
                         return res.status(403).json({
                            message: 'Task Not Yet Available',
                            details: 'Students cannot accept tasks scheduled for future dates early.'
                        });
                    }
                }
            }
        }
        // --- END NEW RULE ---

        // 1b. Check Bidding Task Limits
        if (taskType.task_name === 'Bidding / Nomination Task' && taskType.max_acceptances) {
            const acceptedCount = await TaskAssign.count({
                where: {
                    task_id: taskId,
                    status: { [Op.in]: ['accepted', 'completed', 'in_progress'] }
                }
            });

            if (acceptedCount >= taskType.max_acceptances) {
                return res.status(400).json({
                    message: "Task Expired: Limit reached",
                    details: "This bidding task has already reached its maximum number of acceptances."
                });
            }
        }

        // 1c. Maximum Daily Task Limit (Rule 12.2)
        const { MAX_DAILY_TASKS } = require('../config/constants');
        const dailyCount = await TaskAssign.count({
            where: { user_id: userId, status: { [Op.in]: ['accepted', 'in_progress'] } },
            include: [{
                model: Task,
                required: true,
                include: [{ model: TaskType, where: { start_date: taskType.start_date } }]
            }]
        });

        if (dailyCount >= MAX_DAILY_TASKS) {
            return res.status(403).json({
                message: 'Daily task limit reached',
                details: `You already have ${MAX_DAILY_TASKS} active tasks for ${taskType.start_date.toISOString().split('T')[0]}.`
            });
        }

        // 2. Conflict Detection: Check for overlapping tasks
        const { checkTaskOverlap } = require('../utils/task-utils');
        const conflict = await checkTaskOverlap(userId, {
            start_date: taskType.start_date,
            end_date: taskType.end_date,
            start_time: taskType.start_time,
            end_time: taskType.end_time,
            task_name: taskType.task_name,
            priority: assignment.Task?.priority || 'low'
        }, taskId);

        if (conflict.hasConflict) {
            if (conflict.type === 'priority_override') {
                if (conflict.can_pause) {
                    // Rule 7: Auto-pause Long Task
                    const { Task: ConflictTask } = require('../models');
                    const cTask = await ConflictTask.findByPk(conflict.conflictTask.task_id);
                    if (cTask) {
                        await cTask.update({ is_paused: true, status: 'PAUSED' });
                        await TaskLog.create({
                            task_id: cTask.task_id,
                            user_id: userId,
                            action: 'pause',
                            details: `Auto-paused due to overlapping higher priority task "${assignment.Task.title}"`
                        });
                        // Continue to accept the new task
                    }
                } else {
                    // Rule 3: Manual override required for standard tasks
                    return res.status(409).json({
                        message: "Priority Override Required",
                        details: `Task "${assignment.Task.title}" has higher priority than conflicting task "${conflict.conflictTask.title}", but replacement requires creator approval.`,
                        conflict_task_id: conflict.conflictTask.task_id,
                        type: 'priority_override_request'
                    });
                }
            } else {
                return res.status(412).json({
                    message: "Time Conflict Detected",
                    details: conflict.reason || "This task overlaps with an existing schedule.",
                    conflict_task_id: conflict.conflictTask?.task_id
                });
            }
        }

        // 3. Update assignment
        await assignment.update({
            status: 'accepted',
            accepted_at: new Date()
        });

        // --- NEW: Auto-accept Remaining Days in Series ---
        try {
            const task = assignment.Task;
            if (task) {
                // Find other pending assignments for the same user, title, and creator
                // This mimics a "series" since recurring tasks share these traits
                const otherAssignments = await TaskAssign.findAll({
                    where: {
                        user_id: userId,
                        status: 'pending'
                    },
                    include: [{
                        model: Task,
                        where: {
                            title: task.title,
                            creator_id: task.creator_id,
                            is_deleted: false,
                            task_id: { [Op.ne]: taskId }
                        }
                    }]
                });

                if (otherAssignments.length > 0) {
                    for (const other of otherAssignments) {
                        await other.update({
                            status: 'accepted',
                            accepted_at: new Date(),
                            reason: 'Auto-accepted via recurring series approval'
                        });
                        
                        await TaskLog.create({
                            task_id: other.task_id,
                            user_id: userId,
                            action: 'accept',
                            details: `Task auto-accepted as part of series following acceptance of Task ID ${taskId}`
                        });
                    }
                }
            }
        } catch (seriesError) {
            console.error('Error in auto-accepting series:', seriesError);
            // Non-blocking error
        }

        // 4. Log Action
        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'accept',
            details: `Task accepted at ${new Date().toISOString()}`
        });

        // If this task is part of a pending approval request and the current user is the approver,
        // we should finalize the assignments for everyone else.
        const approvalRequest = await TaskApprovalRequest.findOne({
            where: {
                status: 'pending',
                approver_id: userId,
                [Op.or]: [
                    { task_id: taskId },
                    { task_ids: { [Op.like]: `%${taskId}%` } }
                ]
            }
        });

        if (approvalRequest) {
            let isMatch = approvalRequest.task_id == taskId;
            if (!isMatch && approvalRequest.task_ids) {
                try {
                    const ids = Array.isArray(approvalRequest.task_ids) ? approvalRequest.task_ids : JSON.parse(approvalRequest.task_ids);
                    if (ids.includes(taskId * 1) || ids.includes(taskId.toString())) isMatch = true;
                } catch (e) {
                    console.error('Error parsing approvalRequest.task_ids:', e);
                }
            }

            if (isMatch) {
                const taskController = require('./task.controller.js');
                // Use a separate try/catch to ensure task acceptance succeeds even if finalization has minor issues
                try {
                    await taskController.finalizeTaskAssignments(approvalRequest);
                    await approvalRequest.update({ status: 'approved' });
                } catch (finalizeError) {
                    console.error('Error in automatic approval finalization:', finalizeError);
                }
            }
        }

        res.json({
            message: 'Task accepted successfully',
            assignment: {
                task_id: assignment.task_id,
                status: 'accepted',
                accepted_at: assignment.accepted_at
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Reject assigned task
exports.rejectTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const { reason, transfer_to_user_id } = req.body;
        const userId = req.userId;

        // Find assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId },
            include: [
                { model: Task, include: [{ model: TaskType }] },
                { model: User }
            ]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Task assignment not found' });
        }

        // Check if already processed
        if (assignment.status !== 'pending') {
            return res.status(400).json({
                message: `Task already ${assignment.status}`
            });
        }

        // Validate reason is provided if not transferring
        if (!transfer_to_user_id && (!reason || reason.trim().length === 0)) {
            return res.status(400).json({
                message: 'Rejection reason is required if not transferring the task'
            });
        }

        const task = assignment.Task;
        const user = assignment.User;

        // Check if user can reject using helper
        const canReject = await canUserRejectTask(task, user);

        if (!canReject.allowed) {
            return res.status(403).json({ message: canReject.reason });
        }

        // --- NEW: Task Transfer Logic ---
        if (transfer_to_user_id) {
            // Validate target user
            const targetUser = await User.findByPk(transfer_to_user_id);
            if (!targetUser) {
                return res.status(404).json({ message: 'Transfer target user not found' });
            }

            // Create new assignment for target user
            await TaskAssign.create({
                task_id: taskId,
                user_id: transfer_to_user_id,
                status: 'pending',
                reason: `Transferred from ${user.user_id} (${reason || 'No specific reason provided'})`
            });

            // Notify target user
            await Notification.create({
                user_id: transfer_to_user_id,
                title: 'Task Transferred to You',
                msg: `Task "${task.title}" has been transferred to you by another user.`,
                type: 'task_transfer'
            });

            // Notify creator about transfer
            await Notification.create({
                user_id: task.creator_id,
                title: 'Task Transferred',
                msg: `User ${userId} transferred task "${task.title}" to User ${transfer_to_user_id}.`,
                type: 'task_transfer'
            });
        }

        // Update current assignment
        await assignment.update({
            status: 'rejected',
            reason: reason ? reason.trim() : null,
            rejected_at: new Date(),
            submitted_time: new Date()
        });

        // 4. Log Rejection
        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: transfer_to_user_id ? 'reject_and_transfer' : 'reject',
            details: reason ? `Reason: ${reason}` : 'No reason provided'
        });

        // Notify creator about rejection
        if (!transfer_to_user_id) { // Only notify creator of rejection if not transferred
            await Notification.create({
                user_id: task.creator_id,
                title: 'Task Rejected',
                msg: `User ${userId} rejected task "${task.title}". Reason: ${reason}`,
                type: 'task_rejected'
            });
        }

        // --- NEW: Immediate Escalation for Permission Tasks ---
        const isPermissionTask = task.title.startsWith('Permission:') || task.parent_task_id != null;
        const { Op } = require('sequelize');

        // Helper: Find if this task was transferred from someone using TaskLog
        const lastTransferLog = await TaskLog.findOne({
            where: {
                task_id: taskId,
                action: { [Op.in]: ['transfer', 'reject_and_transfer'] }
            },
            order: [['created_at', 'DESC']]
        });

        const transferrerId = lastTransferLog ? lastTransferLog.user_id : null;

        if (isPermissionTask) {
            await task.update({ is_escalate: true });

            // 1. Escalate to Creator
            await TaskEscalation.create({
                task_id: taskId,
                reason: `IMMEDIATE: Permission Rejected - ${reason ? reason.trim() : 'No reason provided'}`,
                msg: `Critical permission task was denied by the assignee.`,
                creator_id: task.creator_id,
                rejected_user_id: userId,
                status: 'pending',
                is_read: false
            });

            // 2. Escalate to Transferrer (if exists)
            if (transferrerId && transferrerId != task.creator_id) {
                await TaskEscalation.create({
                    task_id: taskId,
                    reason: `Transfer Rejected: ${reason ? reason.trim() : 'No reason provided'}`,
                    msg: `User ${userId} rejected the permission task you transferred to them.`,
                    creator_id: transferrerId,
                    rejected_user_id: userId,
                    status: 'pending',
                    is_read: false
                });
            }

            // Specific notification for escalation
            await Notification.create({
                user_id: task.creator_id,
                title: 'URGENT: Permission Denied',
                msg: `A critical permission task "${task.title}" was rejected! Immediate action required.`,
                type: 'task_escalation'
            });

            if (transferrerId && transferrerId != task.creator_id) {
                await Notification.create({
                    user_id: transferrerId,
                    title: 'URGENT: Transferred Permission Denied',
                    msg: `The permission task "${task.title}" you transferred was rejected by the new assignee.`,
                    type: 'task_escalation'
                });
            }
        } else {
            // General escalation for non-permission tasks
            await task.update({ is_escalate: true });

            // 1. Escalate to Creator
            await TaskEscalation.create({
                task_id: taskId,
                reason: reason ? reason.trim() : 'No reason provided',
                msg: `Task was rejected by ${user.user_id}.`,
                creator_id: task.creator_id,
                rejected_user_id: userId,
                status: 'pending',
                is_read: false
            });

            // 2. Escalate to Transferrer (if exists)
            if (transferrerId && transferrerId != task.creator_id) {
                await TaskEscalation.create({
                    task_id: taskId,
                    reason: `Transfer Rejected: ${reason ? reason.trim() : 'No reason provided'}`,
                    msg: `User ${userId} rejected the task you transferred to them.`,
                    creator_id: transferrerId,
                    rejected_user_id: userId,
                    status: 'pending',
                    is_read: false
                });

                await Notification.create({
                    user_id: transferrerId,
                    title: 'Transfer Rejected',
                    msg: `User ${userId} rejected the task "${task.title}" you transferred to them.`,
                    type: 'task_escalation'
                });
            }
        }

        res.json({
            message: transfer_to_user_id ? 'Task transferred successfully' : 'Task rejected successfully',
            assignment: {
                task_id: assignment.task_id,
                status: assignment.status,
                reason: assignment.reason,
                rejected_at: assignment.rejected_at
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Helper: Check if user can reject task
const canUserRejectTask = async (task, user) => {
    // If mandatory, no one can reject
    if (task.is_mandatory) {
        return {
            allowed: false,
            reason: 'This is a mandatory task and cannot be rejected'
        };
    }

    // Everyone can reject non-mandatory tasks
    // If specific logic is needed for students, add here. 
    // Currently allowing everyone based on user request: "everyone want to approve or reject"
    return { allowed: true };
};

// Transfer task (especially for already accepted tasks with penalty)
exports.transferTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id: taskId } = req.params;
        const { transfer_to_user_id, reason } = req.body;
        const userId = req.userId;

        if (!transfer_to_user_id) {
            return res.status(400).json({ message: 'transfer_to_user_id is required' });
        }

        // 1. Find current assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId },
            include: [{ model: Task }, { model: User }]
        });

        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ message: 'Task assignment not found' });
        }

        const task = assignment.Task;
        const taskType = task.TaskTypes?.[0];
        const previousStatus = assignment.status;

        // Rule 4: Task Lock Window (30 mins)
        if (taskType && taskType.start_time) {
            const now = new Date();
            const startDateTime = new Date(taskType.start_date);
            const [h, m] = taskType.start_time.split(':');
            startDateTime.setHours(h, m, 0, 0);

            const diffMs = startDateTime - now;
            const diffMin = diffMs / (1000 * 60);

            if (diffMin <= 30 && diffMin > -60) { // Lock window: 30 mins before start until 60 mins after (or logic)
                await t.rollback();
                return res.status(403).json({ 
                    message: 'Task is locked', 
                    details: 'Tasks cannot be transferred or reassigned within 30 minutes of the start time.' 
                });
            }
        }

        // 2. Apply Penalty if task was already accepted
        if (previousStatus === 'accepted') {
            await applyPenalty(userId, 2, `Transfer penalty for task: ${task.title}`, t);
        }

        // 3. Create new assignment for target user
        await TaskAssign.create({
            task_id: taskId,
            user_id: transfer_to_user_id,
            status: 'pending',
            reason: `Transferred from ${userId} (${reason || 'Accepted task transfer'})`
        }, { transaction: t });

        // 4. Update current assignment to rejected/transferred
        await assignment.update({
            status: 'rejected',
            reason: reason || 'Transferred to another user',
            rejected_at: new Date()
        }, { transaction: t });

        // 5. Log Action
        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'transfer',
            details: `Transferred from User ${userId} to User ${transfer_to_user_id}. Prev Status: ${previousStatus}. Reason: ${reason}`
        }, { transaction: t });

        // 6. Notify both users and creator
        await Notification.create({
            user_id: transfer_to_user_id,
            title: 'Task Transferred to You',
            msg: `Task "${task.title}" has been transferred to you.`,
            type: 'task_transfer'
        }, { transaction: t });

        await Notification.create({
            user_id: task.creator_id,
            title: 'Task Transferred',
            msg: `User ${userId} transferred task "${task.title}" to User ${transfer_to_user_id}.`,
            type: 'task_transfer'
        }, { transaction: t });

        await t.commit();

        res.json({
            message: 'Task transferred successfully',
            penalty_applied: previousStatus === 'accepted' ? 2 : 0
        });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Helper: Apply penalty to user
const applyPenalty = async (userId, points, reason, transaction) => {
    const user = await User.findByPk(userId);
    if (!user) return;

    // Based on user role, update specific table
    const role = user.role.toLowerCase();
    if (role === 'student') {
        const student = await Student.findOne({ where: { user_id: userId } });
        if (student) await student.increment('penalty', { by: points, transaction });
    } else if (role === 'faculty') {
        const faculty = await Faculty.findOne({ where: { user_id: userId } });
        if (faculty) await faculty.increment('penalty', { by: points, transaction });
    } else if (role === 'staff') {
        const staff = await Staff.findOne({ where: { user_id: userId } });
        if (staff) await staff.increment('penalty', { by: points, transaction });
    } else if (role === 'role-user') {
        const roleUser = await RoleUser.findOne({ where: { user_id: userId } });
        if (roleUser) await roleUser.increment('penalty', { by: points, transaction });
    }
};

// Resolve a conflict by swapping (Rejecting old task, Accepting new one)
exports.resolveConflictWithSwap = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id: taskId } = req.params; // The NEW task id
        const { conflict_task_id, escalation_id } = req.body;
        const userId = req.userId;

        // 1. Find the NEW task assignment
        const newAssignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId },
            include: [{ model: Task }]
        });

        // 2. Find the OLD task assignment (to be rejected)
        const oldAssignment = await TaskAssign.findOne({
            where: { task_id: conflict_task_id, user_id: userId },
            include: [{ model: Task }]
        });

        if (!newAssignment || !oldAssignment) {
            await t.rollback();
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // 3. Reject Old Task
        await oldAssignment.update({
            status: 'rejected',
            reason: `System: Swapped for task '${newAssignment.Task.title}'`,
            rejected_at: new Date()
        }, { transaction: t });

        await TaskLog.create({
            task_id: conflict_task_id,
            user_id: userId,
            action: 'swap_reject',
            details: `Task rejected automatically due to overlap with '${newAssignment.Task.title}'`
        }, { transaction: t });

        // 4. Accept New Task
        await newAssignment.update({
            status: 'accepted',
            accepted_at: new Date()
        }, { transaction: t });

        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'swap_accept',
            details: `Task accepted via swap with '${oldAssignment.Task.title}'`
        }, { transaction: t });

        // 5. Mark Escalation as Resolved/Read
        if (escalation_id) {
            await TaskEscalation.update({
                status: 'resolved',
                is_read: true
            }, { where: { id: escalation_id }, transaction: t });
        }

        await t.commit();
        res.json({ message: 'Conflict resolved: Swapped tasks successfully' });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Update escalation read status
exports.updateEscalationReadStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const escalation = await TaskEscalation.findByPk(id);
        if (!escalation) return res.status(404).json({ message: 'Escalation not found' });

        // Guard: Only involved users or task creator can mark as read/resolved
        if (escalation.creator_id != userId && escalation.rejected_user_id != userId) {
            return res.status(403).json({ message: 'You are not authorized to resolve this escalation' });
        }

        await escalation.update({
            is_read: true,
            status: 'resolved'
        });

        res.json({
            message: 'Escalation marked as read and resolved',
            escalation_id: id,
            status: 'resolved'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Cancel approved task (Move to rejected and escalate)
exports.cancelApproval = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id: taskId } = req.params;
        const { reason } = req.body;
        const userId = req.userId;

        // 1. Find assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId, status: 'accepted' },
            include: [{ model: Task }]
        });

        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ message: 'Accepted task assignment not found' });
        }

        const task = assignment.Task;

        // 2. Update status to rejected
        const cancelReason = reason ? `Approved cancellation: ${reason}` : 'Approval cancelled by user';
        await assignment.update({
            status: 'rejected',
            reason: cancelReason,
            rejected_at: new Date(),
            submitted_time: new Date()
        }, { transaction: t });

        // 3. Trigger Escalation to Creator
        await TaskEscalation.create({
            task_id: taskId,
            reason: 'Approval Cancelled',
            msg: `User ${userId} cancelled their approval for task "${task.title}". Status moved to rejected.`,
            creator_id: task.creator_id,
            rejected_user_id: userId,
            status: 'pending',
            is_read: false
        }, { transaction: t });

        // 4. Notify Creator
        await Notification.create({
            user_id: task.creator_id,
            title: 'Task Approval Cancelled',
            msg: `Action required: User ${userId} has cancelled their approval for "${task.title}".`,
            type: 'task_escalation'
        }, { transaction: t });

        // 5. Log Action
        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'cancel_approval',
            details: cancelReason
        }, { transaction: t });

        await t.commit();

        res.json({
            message: 'Approval cancelled and task rejected successfully',
            task_id: taskId,
            status: 'rejected'
        });

    } catch (error) {
        await t.rollback();
        console.error('Error in cancelApproval:', error);
        res.status(500).json({ message: error.message });
    }
};


// ─── APPROVAL GATE ENDPOINTS ─────────────────────────────────────────────────

// Get pending approval requests for the logged-in user (their inbox)
exports.getPendingApprovalRequests = async (req, res) => {
    try {
        const userId = req.userId;
        const requests = await TaskApprovalRequest.findAll({
            where: { approver_id: userId, status: 'pending' },
            order: [['created_at', 'DESC']]
        });
        res.json(requests);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Approve a pending task request → creates the task and assigns it
exports.approveRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const userId = req.userId;

        const request = await TaskApprovalRequest.findByPk(requestId);
        if (!request) return res.status(404).json({ message: 'Approval request not found' });
        if (request.approver_id !== userId) return res.status(403).json({ message: 'You are not the approver for this request' });
        if (request.status !== 'pending') return res.status(400).json({ message: `Request already ${request.status}` });

        // Use the new finalize helper from task controller
        const taskController = require('./task.controller.js');
        await taskController.finalizeTaskAssignments(request);

        // Mark request as approved
        await request.update({ status: 'approved' });

        // Notify creator
        await Notification.create({
            user_id: request.creator_id,
            title: 'Task Approved!',
            msg: `Your task request was approved and has been assigned.`,
            type: 'task_approved'
        });

        res.json({ message: 'Task approved and assignments created successfully.' });

    } catch (error) {
        console.error('Error in approveRequest:', error);
        res.status(500).json({ message: error.message });
    }
};

// Reject a pending task request → discards silently, notifies creator only
exports.rejectRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body;
        const userId = req.userId;

        const request = await TaskApprovalRequest.findByPk(requestId);
        if (!request) return res.status(404).json({ message: 'Approval request not found' });
        if (request.approver_id !== userId) return res.status(403).json({ message: 'You are not the approver for this request' });
        if (request.status !== 'pending') return res.status(400).json({ message: `Request already ${request.status}` });

        // Mark the task(s) as deleted
        const { Task } = require('../models');
        const taskIds = request.task_ids || [request.task_id];
        if (taskIds.length > 0) {
            await Task.update({ is_deleted: true, status: 'Inactive' }, { where: { task_id: taskIds } });
        }

        // Mark as rejected and store reason
        await request.update({ status: 'rejected', reason: reason || 'No reason provided' });

        // Notify creator only
        await Notification.create({
            user_id: request.creator_id,
            title: 'Task Request Rejected',
            msg: `Your task request was rejected by the approver. Reason: ${reason || 'No reason provided'}`,
            type: 'task_rejected'
        });

        res.json({ message: 'Task request rejected and hidden. Creator has been notified.' });

    } catch (error) {
        console.error('Error in rejectRequest:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
