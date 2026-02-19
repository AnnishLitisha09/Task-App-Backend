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

module.exports = exports;
