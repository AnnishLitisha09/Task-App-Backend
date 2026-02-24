const { Task, TaskAssign, TaskType, User, TaskEscalation, Notification, Faculty, TaskLog, Student, Staff, RoleUser } = require('../models');

// Accept assigned task
exports.acceptTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;

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

        // 2. Conflict Detection: Check for overlapping accepted/completed tasks
        if (taskType.start_date && taskType.start_time && taskType.end_time) {
            const { Op } = require('sequelize');

            // Find all other accepted/completed tasks for this user on the same day
            const existingAssignments = await TaskAssign.findAll({
                where: {
                    user_id: userId,
                    task_id: { [Op.ne]: taskId },
                    status: { [Op.in]: ['accepted', 'completed'] }
                },
                include: [{
                    model: Task,
                    required: true,
                    include: [{
                        model: TaskType,
                        required: true,
                        where: {
                            start_date: taskType.start_date,
                            [Op.and]: [
                                { start_time: { [Op.lt]: taskType.end_time } },
                                { end_time: { [Op.gt]: taskType.start_time } }
                            ]
                        }
                    }]
                }]
            });

            if (existingAssignments.length > 0) {
                const conflict = existingAssignments[0].Task;

                // --- NEW: Self-Escalation & Notification for Overlap ---
                await TaskEscalation.create({
                    task_id: taskId,
                    reason: `System: Time conflict with '${conflict.title}'`,
                    msg: `You are trying to assign two tasks at the same time: '${assignment.Task.title}' and '${conflict.title}'.`,
                    creator_id: userId,
                    rejected_user_id: userId,
                    status: 'pending',
                    is_read: false
                });

                await Notification.create({
                    user_id: userId,
                    title: 'Time Conflict Detected',
                    msg: `Urgent: Task '${assignment.Task.title}' overlaps with '${conflict.title}'. Please review your schedule.`,
                    type: 'task_escalation'
                });

                return res.status(412).json({
                    message: "Time Conflict Detected",
                    details: `You already have an accepted task '${conflict.title}' during this time slot. Self-escalation triggered.`,
                    conflict_task_id: conflict.task_id
                });
            }
        }

        // 3. Update assignment
        await assignment.update({
            status: 'accepted',
            accepted_at: new Date()
        });

        // 4. Log Action
        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'accept',
            details: `Task accepted at ${new Date().toISOString()}`
        });

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
        const previousStatus = assignment.status;

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

module.exports = exports;
