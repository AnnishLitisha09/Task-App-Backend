const { Task, TaskAssign, TaskType, User } = require('../models');

// Accept assigned task
exports.acceptTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;

        // Find assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId }
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

        // Update assignment
        await assignment.update({
            accepted_at: new Date()
        });

        res.json({
            message: 'Task accepted successfully',
            assignment: {
                task_id: assignment.task_id,
                status: assignment.status,
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
        const { reason } = req.body;
        const userId = req.userId;

        // Validate reason is provided
        if (!reason || reason.trim().length === 0) {
            return res.status(400).json({
                message: 'Rejection reason is required'
            });
        }

        // Find assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId },
            include: [
                { model: Task },
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

        const task = assignment.Task;
        const user = assignment.User;

        // Check if user can reject using helper
        const canReject = await canUserRejectTask(task, user);

        if (!canReject.allowed) {
            return res.status(403).json({ message: canReject.reason });
        }

        // Update assignment
        await assignment.update({
            status: 'rejected',
            reason: reason.trim(),
            rejected_at: new Date(),
            submitted_time: new Date()
        });

        // Set task escalation flag
        await task.update({
            is_escalate: true
        });

        // TODO: Send notification to task creator
        // await sendRejectionNotification(task.creator_id, user, task, reason);

        res.json({
            message: 'Task rejected successfully',
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

    const userRole = user.role;

    // Students can only reject bidding tasks
    if (userRole === 'student') {
        const taskType = await TaskType.findOne({
            where: { task_id: task.task_id }
        });

        const isBiddingTask = taskType?.task_name === 'Bidding / Nomination Task';

        if (!isBiddingTask) {
            return {
                allowed: false,
                reason: 'Students cannot reject this type of task'
            };
        }
    }

    // Faculty, role-user, staff can reject non-mandatory tasks
    if (['faculty', 'role-user', 'staff'].includes(userRole)) {
        return { allowed: true };
    }

    // Admin can reject (though shouldn't be assigned tasks typically)
    if (userRole === 'admin') {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: 'You do not have permission to reject this task'
    };
};

module.exports = exports;
