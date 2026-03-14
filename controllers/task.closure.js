const { Task, TaskAssign, TaskClosure, TaskPackageClosure, User, TaskLog } = require('../models');

// Close Task
exports.closeTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id: taskId } = req.params;
        const { closure_id, is_completed, proof, reason } = req.body;
        const userId = req.userId;

        // Check if task exists
        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Validate closure_id if provided
        if (closure_id) {
            const closure = await TaskClosure.findByPk(closure_id);
            if (!closure) {
                return res.status(404).json({ message: 'Task closure type not found' });
            }
        }

        // Check if task is a package task
        if (task.is_package && closure_id) {
            // Create TaskPackageClosure entry
            await TaskPackageClosure.create({
                task_id: taskId,
                closure_id: closure_id
            }, { transaction: t });
        }

        // Update task status
        await task.update({
            status: is_completed ? 'Inactive' : task.status
        }, { transaction: t });

        // Update assignment if user is assigned
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId }
        });

        if (assignment) {
            await assignment.update({
                status: is_completed ? 'completed' : 'rejected',
                proof: proof || null,
                reason: reason || null,
                submitted_time: new Date()
            }, { transaction: t });

            await TaskLog.create({
                task_id: taskId,
                user_id: userId,
                action: is_completed ? 'complete' : 'reject_on_close',
                details: `Task closed with status: ${is_completed ? 'completed' : 'rejected'}`
            }, { transaction: t });

            // SEQUENTIAL LOGIC: If completed and part of a package, trigger next sub-task
            if (is_completed && task.parent_task_id) {
                const nextSubTask = await Task.findOne({
                    where: { 
                        parent_task_id: task.parent_task_id, 
                        sequence_order: task.sequence_order + 1,
                        is_deleted: false
                    }
                });

                if (nextSubTask) {
                    const nextAssignment = await TaskAssign.findOne({
                        where: { task_id: nextSubTask.task_id, user_id: userId, status: 'queued' }
                    });

                    if (nextAssignment) {
                        const Notification = require('../models').Notification;
                        
                        // Move to pending (or accepted if mandatory/staff? for now pending is safer)
                        // Actually, if it was queued, we should probably follow the same auto-accept logic or just move to pending
                        await nextAssignment.update({ status: 'pending' }, { transaction: t });

                        await Notification.create({
                            user_id: userId,
                            title: 'Next Sub-task Available',
                            msg: `Sub-task "${nextSubTask.title}" is now available for you.`,
                            type: 'task_created'
                        }, { transaction: t });

                        await TaskLog.create({
                            task_id: nextSubTask.task_id,
                            user_id: userId,
                            action: 'unqueued',
                            details: `Sub-task unqueued after completion of sequence ${task.sequence_order}.`
                        }, { transaction: t });
                    }
                }
            }
        } else {
            // Still log that the task itself was updated
            await TaskLog.create({
                task_id: taskId,
                user_id: userId,
                action: 'close',
                details: `Task marked as ${is_completed ? 'Inactive' : 'Active'}`
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: 'Task closed successfully' });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Get all closure types
exports.getClosureTypes = async (req, res) => {
    try {
        const closures = await TaskClosure.findAll();
        res.json(closures);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Start Task (For No Closure)
exports.startTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;

        // Check if task exists
        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            await t.rollback();
            return res.status(404).json({ message: 'Task not found' });
        }

        // Find assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: taskId, user_id: userId }
        });

        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ message: 'Task assignment not found' });
        }

        // Transition: must be in 'accepted' (or 'pending' for some roles)
        if (assignment.status !== 'accepted' && assignment.status !== 'pending') {
            await t.rollback();
            return res.status(400).json({ 
                message: `Task cannot be started from current status: ${assignment.status}`,
                current_status: assignment.status
            });
        }

        // Update status to in_progress
        await assignment.update({
            status: 'in_progress'
        }, { transaction: t });

        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'start_task',
            details: `Task started by user ${userId}. Status moved to in_progress.`
        }, { transaction: t });

        await t.commit();
        res.json({ 
            message: 'Task started successfully',
            task_id: taskId,
            status: 'in_progress'
        });

    } catch (error) {
        if (t) await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
