const { Task, TaskAssign, TaskType, TaskPackageClosure, User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department } = require('../models');
const XLSX = require('xlsx');
const { canAssignTo } = require('./task.assignment');

// Helper: Check if user can create tasks
const canCreateTask = (userRole) => {
    return ['admin', 'role-user', 'faculty'].includes(userRole);
};

// Helper: Validate task type specific fields
const validateTaskType = (taskTypeData) => {
    const { task_name, start_date, end_date, start_time, end_time, recurrence, time_quota_hours, venue_id } = taskTypeData;

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
            if (!time_quota_hours || !venue_id) {
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
            if (!start_time || !end_time || !venue_id) {
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
            start_time: task_type_data.start_time || null,
            end_time: task_type_data.end_time || null,
            time_quota_hours: task_type_data.time_quota_hours || null,
            venue_id: task_type_data.venue_id || null,
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

// Create Unified Task (Task + Type + Assignment + Closure)
exports.createUnifiedTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const userId = req.userId;
        const userRole = req.userRole;

        if (!canCreateTask(userRole)) {
            return res.status(403).json({ message: 'You do not have permission to create tasks' });
        }

        let {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            is_approved, approver_id,
            resource_id, is_faculty, faculty_id,
            task_type_data,
            assignee_ids, // [1, 2, 3] or single ID
            assign_to_groups, // [ { role: 'STUDENT', department_id: 1 }, { role: 'STAFF' } ]
            closure_ids // [1, 2]
        } = req.body;

        // Handle multipart/form-data (parse JSON strings if necessary)
        try {
            if (typeof task_type_data === 'string') task_type_data = JSON.parse(task_type_data);
            if (typeof assignee_ids === 'string') {
                try { assignee_ids = JSON.parse(assignee_ids); } catch (e) { assignee_ids = [assignee_ids]; }
            }
            if (typeof assign_to_groups === 'string') assign_to_groups = JSON.parse(assign_to_groups);
            if (typeof closure_ids === 'string') closure_ids = JSON.parse(closure_ids);
        } catch (e) {
            console.error('Parsing error:', e);
        }

        if (typeof is_approved === 'string') is_approved = is_approved === 'true';
        if (typeof is_mandatory === 'string') is_mandatory = is_mandatory === 'true';

        if (!title || !category || !priority || !task_type_data || !task_type_data.task_name) {
            return res.status(400).json({ message: 'Missing required task or type fields' });
        }

        if (is_approved && !approver_id) {
            return res.status(400).json({ message: 'Approver ID is required when task needs approval' });
        }

        validateTaskType(task_type_data);

        // 1. Create Task
        const task = await Task.create({
            title, description, category, priority,
            is_package: is_package || false,
            venue_id: venue_id || null,
            is_pause_allowed: is_pause_allowed || false,
            score: score || 0,
            penalty_per_hour: penalty_per_hour || 0,
            is_document: is_document || false,
            is_mandatory: is_mandatory || false,
            is_approved: is_approved || false,
            approver_id: approver_id || null,
            resource_id: resource_id || null,
            is_faculty: is_faculty || false,
            faculty_id: faculty_id || null,
            creator_id: userId,
            status: 'Active'
        }, { transaction: t });

        // 2. Create TaskType
        await TaskType.create({
            task_id: task.task_id,
            task_name: task_type_data.task_name,
            start_date: task_type_data.start_date || null,
            end_date: task_type_data.end_date || null,
            start_time: task_type_data.start_time || null,
            end_time: task_type_data.end_time || null,
            time_quota_hours: task_type_data.time_quota_hours || null,
            venue_id: task_type_data.venue_id || null,
            recurrence: task_type_data.recurrence || 'none'
        }, { transaction: t });

        // 3. Handle Assignments
        let finalAssigneeIds = [];

        if (assignee_ids) {
            const ids = Array.isArray(assignee_ids) ? assignee_ids : [assignee_ids];
            ids.forEach(id => { if (id && !finalAssigneeIds.includes(id)) finalAssigneeIds.push(id); });
        }

        if (assign_to_groups && Array.isArray(assign_to_groups)) {
            for (const group of assign_to_groups) {
                let users = [];
                const { role, department_id } = group;

                if (role === 'STUDENT') {
                    users = await Student.findAll({ where: department_id ? { department_id } : {} });
                } else if (role === 'FACULTY') {
                    users = await Faculty.findAll({ where: department_id ? { department_id } : {} });
                } else if (role === 'HOD') {
                    const hodRole = await Role.findOne({ where: { user_role: 'HOD' } });
                    if (hodRole) {
                        const ra = await RoleAssignment.findAll({
                            where: {
                                role_id: hodRole.role_id,
                                ...(department_id && { department_id })
                            }
                        });
                        users = ra;
                    }
                } else if (role === 'STAFF') {
                    users = await Staff.findAll();
                } else {
                    const targetRole = await Role.findOne({ where: { user_role: role } });
                    if (targetRole) {
                        const ra = await RoleAssignment.findAll({
                            where: {
                                role_id: targetRole.role_id,
                                ...(department_id && { department_id })
                            }
                        });
                        users = ra;
                    }
                }
                users.forEach(u => { if (u.user_id && !finalAssigneeIds.includes(u.user_id)) finalAssigneeIds.push(u.user_id); });
            }
        }

        // 3.1 Handle Excel Assignments
        if (req.file) {
            try {
                const workbook = XLSX.readFile(req.file.path);
                const sheetName = workbook.SheetNames[0];
                const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

                for (const row of data) {
                    const { email, user_id } = row;
                    let excelUserId = user_id;

                    if (!excelUserId && email) {
                        const student = await Student.findOne({ where: { email } });
                        const faculty = await Faculty.findOne({ where: { email } });
                        const roleUser = await RoleUser.findOne({ where: { email } });
                        const staff = await Staff.findOne({ where: { email } });
                        excelUserId = student?.user_id || faculty?.user_id || roleUser?.user_id || staff?.user_id;
                    }

                    if (excelUserId) {
                        const numericId = parseInt(excelUserId);
                        if (!isNaN(numericId) && !finalAssigneeIds.includes(numericId)) {
                            finalAssigneeIds.push(numericId);
                        }
                    }
                }
            } catch (excelError) {
                console.error('Excel processing error:', excelError);
            }
        }

        if (finalAssigneeIds.length > 0) {
            const assignments = [];
            for (const assigneeId of finalAssigneeIds) {
                const allowed = await canAssignTo(userId, assigneeId);
                if (allowed) {
                    assignments.push({
                        task_id: task.task_id,
                        user_id: assigneeId,
                        status: is_mandatory ? 'accepted' : 'pending',
                        accepted_at: is_mandatory ? new Date() : null
                    });
                }
            }
            if (assignments.length > 0) {
                await TaskAssign.bulkCreate(assignments, { transaction: t, ignoreDuplicates: true });
            }
        }

        // 4. Handle Closure Rules
        if (closure_ids && Array.isArray(closure_ids)) {
            const closures = closure_ids.map(cid => ({
                task_id: task.task_id,
                closure_id: cid
            }));
            await TaskPackageClosure.bulkCreate(closures, { transaction: t });
        }

        await t.commit();
        res.status(201).json({
            message: 'Unified task created and assigned successfully',
            task_id: task.task_id,
            assigned_count: finalAssigneeIds.length
        });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Update Task
exports.updateTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id, { include: [{ model: TaskType }] });
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Only creator or admin can update
        if (task.creator_id !== userId && userRole !== 'admin') {
            return res.status(403).json({ message: 'Only the creator or an admin can update this task' });
        }

        const {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            is_approved, approver_id, resource_id, is_faculty, faculty_id,
            status, task_type_data
        } = req.body;

        // Update basic task fields
        await task.update({
            title: title || task.title,
            description: description !== undefined ? description : task.description,
            category: category || task.category,
            priority: priority || task.priority,
            is_package: is_package !== undefined ? is_package : task.is_package,
            venue_id: venue_id !== undefined ? venue_id : task.venue_id,
            is_pause_allowed: is_pause_allowed !== undefined ? is_pause_allowed : task.is_pause_allowed,
            score: score !== undefined ? score : task.score,
            penalty_per_hour: penalty_per_hour !== undefined ? penalty_per_hour : task.penalty_per_hour,
            is_document: is_document !== undefined ? is_document : task.is_document,
            is_mandatory: is_mandatory !== undefined ? is_mandatory : task.is_mandatory,
            is_approved: is_approved !== undefined ? is_approved : task.is_approved,
            approver_id: approver_id !== undefined ? approver_id : task.approver_id,
            resource_id: resource_id !== undefined ? resource_id : task.resource_id,
            is_faculty: is_faculty !== undefined ? is_faculty : task.is_faculty,
            faculty_id: faculty_id !== undefined ? faculty_id : task.faculty_id,
            status: status || task.status
        }, { transaction: t });

        // Update TaskType if provided
        if (task_type_data) {
            let typeData = task_type_data;
            if (typeof typeData === 'string') {
                try { typeData = JSON.parse(typeData); } catch (e) { /* use as is if fails */ }
            }

            const taskType = task.TaskTypes && task.TaskTypes[0];
            if (taskType) {
                await taskType.update({
                    task_name: typeData.task_name || taskType.task_name,
                    start_date: typeData.start_date !== undefined ? typeData.start_date : taskType.start_date,
                    end_date: typeData.end_date !== undefined ? typeData.end_date : taskType.end_date,
                    start_time: typeData.start_time !== undefined ? typeData.start_time : taskType.start_time,
                    end_time: typeData.end_time !== undefined ? typeData.end_time : taskType.end_time,
                    time_quota_hours: typeData.time_quota_hours !== undefined ? typeData.time_quota_hours : taskType.time_quota_hours,
                    venue_id: typeData.venue_id !== undefined ? typeData.venue_id : taskType.venue_id,
                    recurrence: typeData.recurrence || taskType.recurrence
                }, { transaction: t });
            }
        }

        await t.commit();
        res.json({ message: 'Task updated successfully' });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Delete Task (Soft Delete)
exports.deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Only creator or admin can delete
        if (task.creator_id !== userId && userRole !== 'admin') {
            return res.status(403).json({ message: 'Only the creator or an admin can delete this task' });
        }

        await task.update({ is_deleted: true, status: 'Inactive' });
        res.json({ message: 'Task deleted successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
