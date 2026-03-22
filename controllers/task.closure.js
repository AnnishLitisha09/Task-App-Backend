const { Task, TaskAssign, TaskClosure, TaskPackageClosure, User, TaskLog, Student, Faculty, Staff, RoleUser, TaskType } = require('../models');

// Close Task
exports.closeTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id: taskId } = req.params;
        const { closure_id, is_completed, proof, reason, obtained_score, penalty: body_penalty } = req.body;
        const userId = req.userId;

        // Check if task exists
        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check if proof is required
        if (task.is_document && !proof) {
            await t.rollback();
            return res.status(400).json({ message: 'Proof/Document is required for this task' });
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
            where: { task_id: taskId, user_id: userId },
            transaction: t
        });

        if (assignment) {
            const user = await User.findByPk(userId, { transaction: t });
            const isStudent = user && user.role === 'student';

            // Lifecycle Enforcement for non-students
            const tt = (await TaskType.findOne({ where: { task_id: taskId } })) || {};
            const isFloating = tt.task_name === 'Floating Task';

            if (is_completed && !isStudent && task.is_document && assignment.status !== 'in_progress' && !isFloating) {
                await t.rollback();
                return res.status(400).json({ message: 'You must start the task (move to in_progress) before completing it.' });
            }

            let penalty = 0;
            let earnedScore = 0;
            
            if (is_completed) {
                if (obtained_score !== undefined && body_penalty !== undefined) {
                    penalty = parseFloat(body_penalty);
                    earnedScore = parseFloat(obtained_score);
                } else {
                    const taskWithTypes = await Task.findByPk(taskId, {
                        include: [{ model: TaskType }],
                        transaction: t
                    });
                    const taskType = taskWithTypes.TaskTypes?.[0];
                    const now = new Date();
                    const deadline = taskType?.end_date ? new Date(taskType.end_date) : null;

                    if (deadline && now > deadline) {
                        const diffMs = now - deadline;
                        const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
                        penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
                    }
                    earnedScore = parseFloat(task.score || 0) - penalty;
                }
            }

            await assignment.update({
                status: is_completed ? 'completed' : 'rejected',
                proof: proof || null,
                reason: reason || null,
                submitted_time: new Date(),
                earned_score: is_completed ? earnedScore : 0,
                penalty_applied: is_completed ? penalty : 0
            }, { transaction: t });

            // Resolve any existing escalations for this user/task
            const { resolveTaskEscalations } = require('../utils/task-utils');
            await resolveTaskEscalations(taskId, userId, t);

            // Update User Profile Scores
            if (is_completed) {
                const user = await User.findByPk(userId, { transaction: t });
                let profile = null;

                if (user.role === 'student') profile = await Student.findOne({ where: { user_id: userId }, transaction: t });
                else if (user.role === 'faculty') profile = await Faculty.findOne({ where: { user_id: userId }, transaction: t });
                else if (user.role === 'role-user') profile = await RoleUser.findOne({ where: { user_id: userId }, transaction: t });
                else if (user.role === 'staff') profile = await Staff.findOne({ where: { user_id: userId }, transaction: t });

                if (profile) {
                    await profile.update({
                        score: parseFloat(profile.score || 0) + earnedScore,
                        penalty: parseFloat(profile.penalty || 0) + penalty,
                        total_score: parseFloat(profile.total_score || 0) + parseFloat(task.score || 0)
                    }, { transaction: t });
                }
            }

            await TaskLog.create({
                task_id: taskId,
                user_id: userId,
                action: is_completed ? 'complete' : 'reject_on_close',
                details: `Task closed with status: ${is_completed ? 'completed' : 'rejected'}`
            }, { transaction: t });

            // SEQUENTIAL LOGIC: If completed and part of a package, trigger next sub-task for ALL assignees
            if (is_completed && task.parent_task_id) {
                const nextSubTask = await Task.findOne({
                    where: { 
                        parent_task_id: task.parent_task_id, 
                        sequence_order: task.sequence_order + 1,
                        is_deleted: false
                    }
                });

                if (nextSubTask) {
                    // Activate ALL queued assignments for this next sub-task
                    const queuedAssignments = await TaskAssign.findAll({
                        where: { task_id: nextSubTask.task_id, status: 'queued' }
                    });

                    if (queuedAssignments.length > 0) {
                        const Notification = require('../models').Notification;
                        
                        for (const qAssign of queuedAssignments) {
                            await qAssign.update({ status: 'pending' }, { transaction: t });

                            await Notification.create({
                                user_id: qAssign.user_id,
                                title: 'Next Sub-task Available',
                                msg: `Sub-task "${nextSubTask.title}" from package "${task.parent_task_id}" is now available for you.`,
                                type: 'task_created'
                            }, { transaction: t });

                            await TaskLog.create({
                                task_id: nextSubTask.task_id,
                                user_id: qAssign.user_id,
                                action: 'unqueued',
                                details: `Sub-task unqueued globally after completion of sequence ${task.sequence_order} by User ${userId}.`
                            }, { transaction: t });
                        }
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
        // After closing/completing task, adjust long task status
        const { adjustLongTaskStatus } = require('../utils/task-utils');
        await adjustLongTaskStatus(userId, t);

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

        // --- NEW: Start Time Enforcement ---
        const taskWithTypes = await Task.findByPk(taskId, {
            include: [{ model: TaskType }],
            transaction: t
        });
        const taskType = taskWithTypes.TaskTypes?.[0];

        // --- Window Enforcement ---
        if (taskType) {
            const now = new Date();
            const dateStr = taskType.start_date ? new Date(taskType.start_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

            // 1. Start Time Check
            if (taskType.start_time) {
                const startDateTime = new Date(`${dateStr}T${taskType.start_time}`);
                if (now < startDateTime) {
                    await t.rollback();
                    return res.status(403).json({
                        message: 'Task Cannot Be Started Yet',
                        details: `This task is scheduled to start at ${startDateTime.toLocaleString()}.`
                    });
                }
            } else if (taskType.start_date) {
                const startDateTime = new Date(taskType.start_date);
                if (now < startDateTime) {
                    await t.rollback();
                    return res.status(403).json({
                        message: 'Task Cannot Be Started Yet',
                        details: `This task is scheduled to start on ${startDateTime.toLocaleDateString()}.`
                    });
                }
            }

            // 2. End Time Check (Deadline)
            if (taskType.end_date) {
                const endDateStr = new Date(taskType.end_date).toISOString().split('T')[0];
                const endTimeStr = taskType.end_time || '23:59:59';
                const deadline = new Date(`${endDateStr}T${endTimeStr}`);
                if (now > deadline) {
                    await t.rollback();
                    return res.status(400).json({
                        message: 'Task Window Has Passed',
                        details: `The deadline for starting this task was ${deadline.toLocaleString()}.`
                    });
                }
            }
        }
        // --- END WINDOW ENFORCEMENT ---
        // --- END NEW RULE ---

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

        // After starting task, adjust long task status
        const { adjustLongTaskStatus } = require('../utils/task-utils');
        await adjustLongTaskStatus(userId, t);

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
