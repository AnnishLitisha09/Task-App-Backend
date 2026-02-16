const { Task, TaskAssign, TaskType, TaskPackageClosure, User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department, TaskEscalation, AuthAccount } = require('../models');
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

        const earnedScore = parseFloat(task.score || 0) - penalty;

        // Update Assignment
        await assignment.update({
            status: 'completed',
            proof,
            submitted_time: now,
            earned_score: earnedScore,
            penalty_applied: penalty
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
        } else if (user.role === 'staff') {
            profile = await Staff.findOne({ where: { user_id: userId } });
        }

        if (profile) {
            const currentScore = parseFloat(profile.score || 0); // Net Score
            const currentPenalty = parseFloat(profile.penalty || 0);
            const currentTotalScore = parseFloat(profile.total_score || 0); // Gross Score

            await profile.update({
                score: currentScore + earnedScore, // Net + (Base - Penalty)
                penalty: currentPenalty + penalty,
                total_score: currentTotalScore + parseFloat(task.score) // Gross + Base
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

// Get formal rejection escalations for a creator (using new model)
exports.getRejectionEscalationsForCreator = async (req, res) => {
    try {
        const userId = req.userId;
        const escalations = await TaskEscalation.findAll({
            where: { creator_id: userId },
            include: [
                { model: Task, attributes: ['task_id', 'title'] },
                {
                    model: User,
                    as: 'RejectedUser',
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'email'] },
                        { model: Faculty, attributes: ['name', 'email'] },
                        { model: Staff, attributes: ['name', 'email'] },
                        { model: RoleUser, attributes: ['name', 'email'] },
                        { model: AuthAccount, attributes: ['email'] }
                    ]
                }
            ],
            order: [['created_at', 'DESC']]
        });

        const formatted = escalations.map(e => {
            const u = e.RejectedUser;
            const details = u.Student || u.Faculty || u.Staff || u.RoleUser;

            let name = details?.name;
            const email = details?.email || u.AuthAccount?.email;

            if (!name) {
                if (u.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                escalation_id: e.id,
                task_id: e.task_id,
                task_title: e.Task?.title,
                reason: e.reason,
                status: e.status,
                created_at: e.created_at,
                rejected_by: {
                    user_id: u.user_id,
                    role: u.role,
                    name: name,
                    email: email || 'Unknown'
                }
            };
        });

        res.json({
            count: formatted.length,
            escalations: formatted
        });

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
                    { model: Staff, attributes: ['name', 'email'] },
                    { model: AuthAccount, attributes: ['email'] }
                ]
            }]
        });

        const users = pendingUsers.map(assignment => {
            const u = assignment.User;
            const details = u.Student || u.Faculty || u.RoleUser || u.Staff;

            let name = details?.name;
            const email = details?.email || u.AuthAccount?.email;

            if (!name) {
                if (u.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                user_id: u.user_id,
                role: u.role,
                name: name,
                email: email || 'Unknown'
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
                    { model: Staff, attributes: ['name', 'email'] },
                    { model: AuthAccount, attributes: ['email'] }
                ]
            }]
        });

        const users = pendingAssignments.map(assignment => {
            const u = assignment.User;
            const details = u.Student || u.Faculty || u.RoleUser || u.Staff;

            let name = details?.name;
            const email = details?.email || u.AuthAccount?.email;

            if (!name) {
                if (u.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                user_id: u.user_id,
                role: u.role,
                name: name,
                email: email || 'Unknown'
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

// Get User Task Stats (Total Score, Penalty, 7-Day Breakdown)
exports.getUserTaskStats = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole; // Assuming this is available from middleware

        const now = new Date();
        const firstDay = new Date(now);
        firstDay.setDate(now.getDate() - 6);
        firstDay.setHours(0, 0, 0, 0);

        // Fetch User Profile for Cumulative Score
        let profile = null;
        if (userRole === 'student') {
            profile = await Student.findOne({ where: { user_id: userId } });
        } else if (userRole === 'faculty') {
            profile = await Faculty.findOne({ where: { user_id: userId } });
        } else if (userRole === 'staff') {
            profile = await Staff.findOne({ where: { user_id: userId } });
        } else if (userRole === 'role-user') {
            profile = await RoleUser.findOne({ where: { user_id: userId } });
        }

        const profileTotalScore = profile ? parseFloat(profile.total_score || 0) : 0; // Gross Score
        const profileNetScore = profile ? parseFloat(profile.score || 0) : 0; // Net Score (Earned)
        const profileTotalPenalty = profile ? parseFloat(profile.penalty || 0) : 0; // Total Penalty

        // Fetch all assignments for the user
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }]
            }],
            order: [['submitted_time', 'DESC']]
        });

        let totalBaseScore = 0;
        let totalPenalty = 0;
        let totalEarnedScore = 0;
        const dailyStats = {};

        // Initialize last 7 days with 0
        for (let i = 0; i < 7; i++) {
            const d = new Date(firstDay);
            d.setDate(firstDay.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            dailyStats[dateStr] = 0;
        }

        const taskDetails = assignments.map(a => {
            if (!a.Task) return null;

            const baseScore = parseFloat(a.Task.score || 0);
            const earnedScore = parseFloat(a.earned_score || 0);
            const penalty = parseFloat(a.penalty_applied || 0);

            if (a.status === 'completed') {
                totalBaseScore += baseScore;
                totalPenalty += penalty;
                totalEarnedScore += earnedScore;

                if (a.submitted_time) {
                    const d = new Date(a.submitted_time);
                    if (!isNaN(d.getTime())) {
                        const submittedDate = d.toISOString().split('T')[0];
                        if (dailyStats.hasOwnProperty(submittedDate)) {
                            dailyStats[submittedDate] += earnedScore;
                        }
                    }
                }
            }

            return {
                task_id: a.task_id,
                title: a.Task.title,
                status: a.status,
                base_score: baseScore,
                earned_score: earnedScore,
                penalty_applied: penalty,
                submitted_time: a.submitted_time,
                submission_type: penalty > 0 ? 'Late Submission' : (a.status === 'completed' ? 'Perfect Submission' : 'N/A')
            };
        }).filter(t => t !== null);

        const last7Days = Object.keys(dailyStats).map(date => ({
            date,
            score: dailyStats[date]
        }));

        res.json({
            total_score: profileTotalScore, // Gross Score (Base scores of all completed tasks)
            total_penalty: profileTotalPenalty,
            earned_score: profileNetScore, // Net Score (Gross - Penalty)
            last_7_days: last7Days,
            task_details: taskDetails
        });

    } catch (error) {
        console.error("Critical error in getUserTaskStats:", error);
        res.status(500).json({ message: error.message });
    }
};


// 1. Get Pending Proof Tasks (Accepted + Document Required + No Proof)
exports.getPendingProofTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        const tasks = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: 'accepted',
                [Op.or]: [
                    { proof: null },
                    { proof: '' }
                ]
            },
            include: [{
                model: Task,
                where: {
                    is_deleted: false,
                    is_document: true
                },
                include: [{ model: TaskType }]
            }]
        });

        const formatted = tasks.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            description: a.Task.description,
            is_document: a.Task.is_document,
            status: a.status,
            proof_status: 'Not Submitted',
            deadline: a.Task.TaskTypes && a.Task.TaskTypes[0]
                ? {
                    end_date: a.Task.TaskTypes[0].end_date,
                    end_time: a.Task.TaskTypes[0].end_time
                } : null
        }));

        res.json({
            count: formatted.length,
            tasks: formatted
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. Get Tasks Assigned Today
exports.getTasksAssignedToday = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const tasks = await TaskAssign.findAll({
            where: {
                user_id: userId,
                created_at: {
                    [Op.gte]: today,
                    [Op.lt]: tomorrow
                }
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }]
            }]
        });

        const formatted = tasks.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            status: a.status,
            assigned_at: a.created_at,
            is_approved: a.Task.is_approved
        }));

        res.json({
            date: today.toISOString().split('T')[0],
            count: formatted.length,
            tasks: formatted
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. Get Approved Upcoming Tasks
exports.getApprovedUpcomingTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();

        // Fetch accepted assignments
        const assignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: 'accepted'
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }]
            }]
        });

        // Filter for Future Start
        const upcoming = assignments.filter(a => {
            const taskType = a.Task.TaskTypes && a.Task.TaskTypes[0];
            if (!taskType) return false;

            let startDateTime = null;
            if (taskType.task_name === 'Fixed Time Task' || taskType.task_name === 'Meeting') {
                if (taskType.start_date && taskType.start_time) {
                    const dateStr = new Date(taskType.start_date).toISOString().split('T')[0];
                    startDateTime = new Date(`${dateStr}T${taskType.start_time}`);
                } else if (taskType.start_date) {
                    startDateTime = new Date(taskType.start_date);
                }
            } else if (taskType.start_date) {
                startDateTime = new Date(taskType.start_date);
            }

            return startDateTime && startDateTime > now;
        });

        const formatted = upcoming.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            start_date: a.Task.TaskTypes[0]?.start_date,
            start_time: a.Task.TaskTypes[0]?.start_time,
            status: a.status
        }));

        res.json({
            count: formatted.length,
            tasks: formatted
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 4. Get Pending Upcoming Tasks (Unapproved & Future Start)
exports.getPendingUpcomingTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();

        // 1. Fetch pending assignments
        const assignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: 'pending'
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }]
            }]
        });

        // 2. Filter for Future Start Date/Time
        const upcoming = assignments.filter(a => {
            const taskType = a.Task.TaskTypes && a.Task.TaskTypes[0];
            if (!taskType) return false;

            let startDateTime = null;
            if (taskType.task_name === 'Fixed Time Task' || taskType.task_name === 'Meeting') {
                if (taskType.start_date && taskType.start_time) {
                    const dateStr = new Date(taskType.start_date).toISOString().split('T')[0];
                    startDateTime = new Date(`${dateStr}T${taskType.start_time}`);
                } else if (taskType.start_date) {
                    startDateTime = new Date(taskType.start_date);
                }
            } else if (taskType.start_date) {
                startDateTime = new Date(taskType.start_date);
            }

            return startDateTime && startDateTime > now;
        });

        const formatted = upcoming.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            start_date: a.Task.TaskTypes[0]?.start_date,
            start_time: a.Task.TaskTypes[0]?.start_time,
            status: a.status
        }));

        res.json({
            count: formatted.length,
            tasks: formatted
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 5. Get Monthly Schedule (Comprehensive: Specific Date or Range)
exports.getMonthlySchedule = async (req, res) => {
    try {
        const userId = req.userId;
        const { date } = req.query;
        const { Op } = require('sequelize');
        const { Venue, Resource, User, AuthAccount, Student, Faculty, Staff, RoleUser, TaskType } = require('../models');

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            if (!d) return null;
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let startDate, endDate;
        if (date) {
            startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);
            if (isNaN(startDate.getTime())) return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
        } else {
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 15);
            endDate = new Date(today);
            endDate.setDate(today.getDate() + 7);
            endDate.setHours(23, 59, 59, 999);
        }

        const startDateStr = getLocalDateString(startDate);
        const endDateStr = getLocalDateString(endDate);

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    {
                        model: TaskType,
                        required: true,
                        where: {
                            [Op.and]: [
                                { start_date: { [Op.lte]: `${endDateStr} 23:59:59` } },
                                {
                                    [Op.or]: [
                                        { end_date: { [Op.gte]: `${startDateStr} 00:00:00` } },
                                        { end_date: null }
                                    ]
                                }
                            ]
                        }
                    },
                    { model: Venue, attributes: ['name', 'location'], required: false },
                    { model: Resource, attributes: ['name'], required: false },
                    {
                        model: User,
                        as: 'Creator',
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: AuthAccount, attributes: ['email'], required: false },
                            { model: Student, attributes: ['name'], required: false },
                            { model: Faculty, attributes: ['name'], required: false },
                            { model: Staff, attributes: ['name'], required: false },
                            { model: RoleUser, attributes: ['name'], required: false }
                        ]
                    }
                ]
            }]
        });

        const schedule = {};

        const isOccurrence = (targetDateStr, tStart, tEnd, recurrence) => {
            const startStr = getLocalDateString(tStart);
            const endStr = tEnd ? getLocalDateString(tEnd) : null;

            if (targetDateStr < startStr) return false;
            if (endStr && targetDateStr > endStr) return false;

            if (recurrence === 'none') return targetDateStr === startStr;
            if (recurrence === 'daily') return true;

            const targetDate = new Date(`${targetDateStr}T00:00:00`);
            const startDate = new Date(`${startStr}T00:00:00`);

            if (recurrence === 'weekly') return targetDate.getDay() === startDate.getDay();
            if (recurrence === 'monthly') return targetDate.getDate() === startDate.getDate();
            return false;
        };

        assignments.forEach(a => {
            const task = a.Task;
            const creator = task.Creator;
            const creatorDetails = creator?.Student || creator?.Faculty || creator?.Staff || creator?.RoleUser;

            let creatorName = creatorDetails?.name;
            if (!creatorName && creator?.role?.toLowerCase() === 'admin') creatorName = 'Administrator';

            task.TaskTypes.forEach(taskType => {
                let current = new Date(startDate);
                // Important: reset current to local midnight for iteration
                current.setHours(0, 0, 0, 0);

                while (current <= endDate) {
                    const currentStr = getLocalDateString(current);
                    if (isOccurrence(currentStr, taskType.start_date, taskType.end_date, taskType.recurrence)) {
                        if (!schedule[currentStr]) schedule[currentStr] = [];

                        schedule[currentStr].push({
                            assignment_id: a.id,
                            task_id: task.task_id,
                            title: task.title,
                            description: task.description,
                            category: task.category,
                            priority: task.priority,
                            status: a.status,
                            score: parseFloat(task.score || 0),
                            penalty: parseFloat(task.penalty_per_hour || 0),
                            flags: {
                                is_package: task.is_package,
                                is_mandatory: task.is_mandatory,
                                is_document: task.is_document,
                                is_approved: task.is_approved
                            },
                            timing: {
                                start_time: taskType.start_time,
                                end_time: taskType.end_time,
                                recurrence: taskType.recurrence
                            },
                            location: task.Venue ? { name: task.Venue.name, location: task.Venue.location } : null,
                            resource: task.Resource ? { name: task.Resource.name } : null,
                            creator: {
                                name: creatorName || 'Unknown',
                                email: creatorDetails?.email || creator?.AuthAccount?.email || 'N/A'
                            }
                        });
                    }
                    current.setDate(current.getDate() + 1);
                }
            });
        });

        Object.keys(schedule).forEach(dKey => {
            schedule[dKey].sort((b, c) => (b.timing.start_time || '').localeCompare(c.timing.start_time || ''));
        });

        if (date) {
            res.json({
                date,
                count: (schedule[date] || []).length,
                tasks: schedule[date] || []
            });
        } else {
            res.json({
                mode: 'Range',
                range: { start: startDateStr, end: endDateStr },
                schedule
            });
        }
    } catch (error) {
        console.error('Error in getMonthlySchedule:', error);
        res.status(500).json({ message: error.message });
    }
};


// 6. Get Task Detail by ID (Comprehensive - All Details)
exports.getTaskDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const { Resource, Venue } = require('../models');

        const task = await Task.findByPk(id, {
            include: [
                {
                    model: TaskType,
                    attributes: ['id', 'task_name', 'start_date', 'end_date', 'start_time', 'end_time', 'time_quota_hours', 'venue_id', 'recurrence']
                },
                {
                    model: Venue,
                    attributes: ['venue_id', 'name', 'venue_type', 'location', 'description', 'image_url'],
                    required: false
                },
                {
                    model: Resource,
                    attributes: ['resource_id', 'name', 'description'],
                    required: false
                },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['user_id', 'role'],
                    required: false,
                    include: [
                        { model: Student, attributes: ['name', 'email'], required: false },
                        { model: Faculty, attributes: ['name', 'email'], required: false },
                        { model: Staff, attributes: ['name', 'email'], required: false },
                        { model: RoleUser, attributes: ['name', 'email'], required: false },
                        { model: AuthAccount, attributes: ['email'], required: false }
                    ]
                },
                {
                    model: User,
                    as: 'Approver',
                    attributes: ['user_id', 'role'],
                    required: false,
                    include: [
                        { model: Student, attributes: ['name', 'email'], required: false },
                        { model: Faculty, attributes: ['name', 'email'], required: false },
                        { model: Staff, attributes: ['name', 'email'], required: false },
                        { model: RoleUser, attributes: ['name', 'email'], required: false },
                        { model: AuthAccount, attributes: ['email'], required: false }
                    ]
                },
                {
                    model: Faculty,
                    attributes: ['user_id', 'name', 'email', 'department_id'],
                    required: false
                },
                {
                    model: TaskAssign,
                    required: false,
                    include: [
                        {
                            model: User,
                            attributes: ['user_id', 'role'],
                            required: false,
                            include: [
                                { model: Student, attributes: ['name', 'email', 'department_id', 'year'], required: false },
                                { model: Faculty, attributes: ['name', 'email', 'department_id'], required: false },
                                { model: Staff, attributes: ['name', 'email'], required: false },
                                { model: RoleUser, attributes: ['name', 'email'], required: false },
                                { model: AuthAccount, attributes: ['email'], required: false }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check if user has permission to view this task
        const canView =
            userRole === 'admin' ||
            task.creator_id === userId ||
            task.TaskAssigns?.some(a => a.user_id === userId);

        if (!canView) {
            return res.status(403).json({ message: 'You do not have permission to view this task' });
        }

        // Format creator info
        let creatorInfo = null;
        if (task.Creator) {
            const creatorDetails = task.Creator.Student || task.Creator.Faculty ||
                task.Creator.Staff || task.Creator.RoleUser;

            let name = creatorDetails?.name;
            const email = creatorDetails?.email || task.Creator.AuthAccount?.email;

            if (!name) {
                if (task.Creator.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            creatorInfo = {
                user_id: task.Creator.user_id,
                role: task.Creator.role,
                name: name,
                email: email || 'Unknown'
            };
        }

        // Format approver info
        let approverInfo = null;
        if (task.Approver) {
            const approverDetails = task.Approver.Student || task.Approver.Faculty ||
                task.Approver.Staff || task.Approver.RoleUser;

            let name = approverDetails?.name;
            const email = approverDetails?.email || task.Approver.AuthAccount?.email;

            if (!name) {
                if (task.Approver.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            approverInfo = {
                user_id: task.Approver.user_id,
                role: task.Approver.role,
                name: name,
                email: email || 'Unknown'
            };
        }

        // Format faculty info (if task is faculty-specific)
        let facultyInfo = null;
        if (task.Faculty) {
            facultyInfo = {
                user_id: task.Faculty.user_id,
                name: task.Faculty.name,
                email: task.Faculty.email,
                department_id: task.Faculty.department_id
            };
        }

        // Format assignees
        const assignees = task.TaskAssigns?.map(assign => {
            const userDetails = assign.User?.Student || assign.User?.Faculty ||
                assign.User?.Staff || assign.User?.RoleUser;

            let name = userDetails?.name;
            const email = userDetails?.email || assign.User?.AuthAccount?.email;

            if (!name) {
                if (assign.User?.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                assignment_id: assign.id,
                user_id: assign.user_id,
                role: assign.User?.role || 'Unknown',
                name: name,
                email: email || 'Unknown',
                department_id: userDetails?.department_id || null,
                year: userDetails?.year || null,
                status: assign.status,
                accepted_at: assign.accepted_at,
                completed_at: assign.completed_at,
                submitted_time: assign.submitted_time,
                proof: assign.proof,
                earned_score: parseFloat(assign.earned_score || 0),
                penalty_applied: parseFloat(assign.penalty_applied || 0),
                is_pause_approved: assign.is_pause_approved,
                pause_start: assign.pause_start,
                pause_end: assign.pause_end
            };
        }) || [];

        // Calculate statistics
        const totalAssignees = assignees.length;
        const acceptedCount = assignees.filter(a => a.status === 'accepted').length;
        const completedCount = assignees.filter(a => a.status === 'completed').length;
        const pendingCount = assignees.filter(a => a.status === 'pending').length;
        const rejectedCount = assignees.filter(a => a.status === 'rejected').length;

        // Task response
        const response = {
            task_id: task.task_id,
            title: task.title,
            description: task.description,
            category: task.category,
            priority: task.priority,
            status: task.status,

            // Scores and Penalties
            score: parseFloat(task.score || 0),
            penalty_per_hour: parseFloat(task.penalty_per_hour || 0),

            // Flags
            is_package: task.is_package,
            is_pause_allowed: task.is_pause_allowed,
            is_document: task.is_document,
            is_mandatory: task.is_mandatory,
            is_approved: task.is_approved,
            is_faculty: task.is_faculty,
            is_deleted: task.is_deleted,
            is_escalate: task.is_escalate,

            // Related IDs
            venue_id: task.venue_id,
            resource_id: task.resource_id,
            creator_id: task.creator_id,
            approver_id: task.approver_id,
            faculty_id: task.faculty_id,

            // Related Details
            creator: creatorInfo,
            approver: approverInfo,
            faculty: facultyInfo,
            venue: task.Venue ? {
                venue_id: task.Venue.venue_id,
                name: task.Venue.name,
                venue_type: task.Venue.venue_type,
                location: task.Venue.location,
                description: task.Venue.description,
                image_url: task.Venue.image_url
            } : null,
            resource: task.Resource ? {
                resource_id: task.Resource.resource_id,
                name: task.Resource.name,
                description: task.Resource.description
            } : null,

            // Task Type Details
            task_types: task.TaskTypes?.map(tt => ({
                id: tt.id,
                task_name: tt.task_name,
                start_date: tt.start_date,
                end_date: tt.end_date,
                start_time: tt.start_time,
                end_time: tt.end_time,
                time_quota_hours: tt.time_quota_hours,
                venue_id: tt.venue_id,
                recurrence: tt.recurrence
            })) || [],

            // Assignees
            assignees: assignees,

            // Assignment Statistics
            assignment_stats: {
                total: totalAssignees,
                pending: pendingCount,
                accepted: acceptedCount,
                completed: completedCount,
                rejected: rejectedCount
            },

            // Timestamps
            created_at: task.created_at,
            updated_at: task.updated_at
        };

        res.json(response);

    } catch (error) {
        console.error('Error in getTaskDetail:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
