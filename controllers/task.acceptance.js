const { Task, TaskAssign, TaskType, User, TaskEscalation } = require('../models');

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
            status: 'accepted',
            accepted_at: new Date()
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
                { model: Task, include: [{ model: TaskType }] }, // Include TaskType for validation if needed
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
            reason: reason.trim(), // Save reason
            rejected_at: new Date(),
            submitted_time: new Date()
        });

        // Set task escalation flag
        await task.update({
            is_escalate: true
        });

        // 6a. Create formal Task Escalation record
        await TaskEscalation.create({
            task_id: taskId,
            reason: reason.trim(),
            creator_id: task.creator_id,
            rejected_user_id: userId,
            status: 'pending'
        });

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

    // Everyone can reject non-mandatory tasks
    // If specific logic is needed for students, add here. 
    // Currently allowing everyone based on user request: "everyone want to approve or reject"
    return { allowed: true };
};

module.exports = exports;
