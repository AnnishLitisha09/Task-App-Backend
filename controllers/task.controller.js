const { Task, TaskAssign, TaskType, User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department } = require('../models');
const XLSX = require('xlsx');

// Helper: Check if user can create tasks
const canCreateTask = (userRole) => {
    return ['admin', 'role-user', 'faculty'].includes(userRole);
};

// Helper: Validate task type specific fields
const validateTaskType = (taskTypeData) => {
    const { task_name, start_date, end_date, start_time, end_time, recurrence } = taskTypeData;

    switch (task_name) {
        case 'Fixed Time Task':
            if (!start_time || !end_time) {
                throw new Error('Fixed Time Task requires start_time and end_time');
            }
            break;
        case 'Date-Only / Long Task':
            if (!start_date || !end_date) {
                throw new Error('Date-Only Task requires start_date and end_date');
            }
            break;
        case 'Floating Task':
            if (!start_date || !end_date || !start_time || !end_time) {
                throw new Error('Floating Task requires start_date, end_date, start_time, and end_time');
            }
            break;
        case 'Subscription Task':
            if (!taskTypeData.time_quota_hours || !taskTypeData.venue_id) {
                throw new Error('Subscription Task requires time_quota_hours and venue_id');
            }
            break;
        case 'Recurring Task':
            if (!recurrence || recurrence === 'none') {
                throw new Error('Recurring Task requires recurrence pattern (daily, weekly, monthly)');
            }
            if (!start_date) {
                throw new Error('Recurring Task requires start_date');
            }
            break;
        case 'Meeting':
            if (!start_time || !end_time || !taskTypeData.venue_id) {
                throw new Error('Meeting requires start_time, end_time, and venue_id');
            }
            break;
        case 'Bidding / Nomination Task':
            // No special validation required
            break;
        default:
            throw new Error(`Unknown task type: ${task_name}`);
    }
};

// Create Task
exports.createTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const userId = req.userId;
        const userRole = req.userRole;

        // Check if user can create tasks
        if (!canCreateTask(userRole)) {
            return res.status(403).json({ message: 'You do not have permission to create tasks' });
        }

        const {
            title,
            description,
            category,
            priority,
            is_package,
            venue_id,
            is_pause_allowed,
            score,
            penalty_per_hour,
            is_document,
            is_mandatory,
            resource_id,
            is_faculty,
            faculty_id,
            task_type_data // { task_name, start_date, end_date, start_time, end_time, recurrence, time_quota_hours }
        } = req.body;

        // Validate required fields
        if (!title || !category || !priority) {
            return res.status(400).json({ message: 'Title, category, and priority are required' });
        }

        if (!task_type_data || !task_type_data.task_name) {
            return res.status(400).json({ message: 'Task type data with task_name is required' });
        }

        // Validate task type specific fields
        validateTaskType(task_type_data);

        // Create Task
        const task = await Task.create({
            title,
            description,
            category,
            priority,
            is_package: is_package || false,
            venue_id: venue_id || null,
            is_pause_allowed: is_pause_allowed || false,
            score: score || 0,
            penalty_per_hour: penalty_per_hour || 0,
            is_document: is_document || false,
            is_mandatory: is_mandatory || false,
            resource_id: resource_id || null,
            is_faculty: is_faculty || false,
            faculty_id: faculty_id || null,
            creator_id: userId,
            status: 'Active'
        }, { transaction: t });

        // Create TaskType
        await TaskType.create({
            task_id: task.task_id,
            task_name: task_type_data.task_name,
            start_date: task_type_data.start_date || null,
            end_date: task_type_data.end_date || null,
            recurrence: task_type_data.recurrence || 'none'
        }, { transaction: t });

        await t.commit();
        res.status(201).json({
            message: 'Task created successfully',
            task_id: task.task_id
        });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Get all tasks
exports.getAllTasks = async (req, res) => {
    try {
        const tasks = await Task.findAll({
            where: { is_deleted: false },
            include: [
                { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                { model: TaskType },
                { model: Faculty, attributes: ['name', 'department_id'] }
            ]
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get task by ID
exports.getTaskById = async (req, res) => {
    try {
        const { id } = req.params;
        const task = await Task.findOne({
            where: { task_id: id, is_deleted: false },
            include: [
                { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                { model: User, as: 'Approver', attributes: ['user_id', 'role'] },
                { model: TaskType },
                {
                    model: TaskAssign,
                    include: [{ model: User, attributes: ['user_id', 'role'] }]
                }
            ]
        });

        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get tasks created by user
exports.getTasksCreatedByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const tasks = await Task.findAll({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType },
                { model: TaskAssign, include: [{ model: User, attributes: ['user_id', 'role'] }] }
            ]
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get tasks assigned to user
exports.getTasksAssignedToUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [
                {
                    model: Task,
                    where: { is_deleted: false },
                    include: [
                        { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                        { model: TaskType }
                    ]
                }
            ]
        });
        res.json(assignments);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Submit Task Proof
exports.submitTaskProof = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const { proof } = req.body;

        if (!proof) {
            return res.status(400).json({ message: 'Proof is required' });
        }

        // Find assignment
        const assignment = await TaskAssign.findOne({
            where: { task_id: id, user_id: userId, status: 'pending' },
            include: [{
                model: Task,
                include: [{ model: TaskType }]
            }]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Pending task assignment not found' });
        }

        const task = assignment.Task;
        const taskType = task.TaskTypes && task.TaskTypes[0];

        if (!taskType) {
            return res.status(500).json({ message: 'Task type data missing' });
        }

        let penalty = 0;
        const now = new Date();
        const deadline = taskType.end_date ? new Date(taskType.end_date) : null;

        // Calculate penalty if late
        if (deadline && now > deadline) {
            const diffMs = now - deadline;
            const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
            penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
        }

        const earnedScore = Math.max(0, parseFloat(task.score || 0) - penalty);

        // Update Assignment
        await assignment.update({
            status: 'completed',
            proof,
            submitted_time: now
        });

        // Update User Profile (Student, Faculty, or RoleUser)
        const user = await User.findByPk(userId);
        let profile = null;

        if (user.role === 'student') {
            profile = await Student.findOne({ where: { user_id: userId } });
        } else if (user.role === 'faculty') {
            profile = await Faculty.findOne({ where: { user_id: userId } });
        } else if (user.role === 'role-user') {
            profile = await RoleUser.findOne({ where: { user_id: userId } });
        }

        if (profile) {
            await profile.update({
                score: parseFloat(profile.score || 0) + earnedScore,
                penalty: parseFloat(profile.penalty || 0) + penalty
            });
        }

        res.json({
            message: 'Task submitted successfully',
            score_earned: earnedScore,
            penalty_applied: penalty,
            status: 'completed'
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get escalated tasks for a creator
exports.getEscalatedTasksForCreator = async (req, res) => {
    try {
        const userId = req.userId;
        const tasks = await Task.findAll({
            where: { creator_id: userId, is_escalate: true, is_deleted: false },
            include: [{ model: TaskType }]
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get escalation report for a specific task
exports.getTaskEscalationReport = async (req, res) => {
    try {
        const { id } = req.params;
        const pendingUsers = await TaskAssign.findAll({
            where: { task_id: id, status: 'pending' },
            include: [{
                model: User,
                attributes: ['user_id', 'role'],
                include: [
                    { model: Student, attributes: ['name', 'email'] },
                    { model: Faculty, attributes: ['name', 'email'] },
                    { model: RoleUser, attributes: ['name', 'email'] },
                    { model: Staff, attributes: ['name', 'email'] }
                ]
            }]
        });

        const users = pendingUsers.map(assignment => {
            const u = assignment.User;
            let details = null;
            if (u.Student) details = u.Student;
            else if (u.Faculty) details = u.Faculty;
            else if (u.RoleUser) details = u.RoleUser;
            else if (u.Staff) details = u.Staff;

            return {
                user_id: u.user_id,
                role: u.role,
                name: details ? details.name : 'Unknown',
                email: details ? details.email : 'Unknown'
            };
        });

        res.json({
            task_id: id,
            pending_count: users.length,
            pending_users: users
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Manually escalate a task
exports.manualEscalateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Only creator or admin can manually escalate
        if (task.creator_id !== userId && userRole !== 'admin') {
            return res.status(403).json({ message: 'Only the creator or an admin can manually escalate this task' });
        }

        await task.update({ is_escalate: true });

        // Get the report to return immediately
        const pendingAssignments = await TaskAssign.findAll({
            where: { task_id: id, status: 'pending' },
            include: [{
                model: User,
                attributes: ['user_id', 'role'],
                include: [
                    { model: Student, attributes: ['name', 'email'] },
                    { model: Faculty, attributes: ['name', 'email'] },
                    { model: RoleUser, attributes: ['name', 'email'] },
                    { model: Staff, attributes: ['name', 'email'] }
                ]
            }]
        });

        const users = pendingAssignments.map(assignment => {
            const u = assignment.User;
            let details = null;
            if (u.Student) details = u.Student;
            else if (u.Faculty) details = u.Faculty;
            else if (u.RoleUser) details = u.RoleUser;
            else if (u.Staff) details = u.Staff;

            return {
                user_id: u.user_id,
                role: u.role,
                name: details ? details.name : 'Unknown',
                email: details ? details.email : 'Unknown'
            };
        });

        res.json({
            message: 'Task manually escalated',
            task_id: id,
            pending_count: users.length,
            pending_users: users
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
