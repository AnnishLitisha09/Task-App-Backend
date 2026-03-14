const { Task, TaskAssign, TaskType, TaskPackageClosure, TaskClosure, User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department, TaskEscalation, AuthAccount, Notification, TaskLog, TaskTitle, Venue, TaskApprovalRequest } = require('../models');
const XLSX = require('xlsx');
const { canAssignTo } = require('./task.assignment');
const { checkTaskOverlap, isWithinWorkHours } = require('../utils/task-utils');
const { MAX_DAILY_TASKS, PRIORITY_WEIGHTS } = require('../config/constants');


// Helper: Pagination
const getPagination = (query) => {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    return { limit, offset, page };
};

const getPagingData = (data, page, limit) => {
    const { count: totalItems, rows: items } = data;
    const currentPage = page ? +page : 1;
    const totalPages = Math.ceil(totalItems / limit);
    return { totalItems, items, totalPages, currentPage };
};

// Helper: Check if user can create tasks
const canCreateTask = (userRole) => {
    return ['admin', 'role-user', 'faculty', 'student', 'staff'].includes(userRole?.toLowerCase());
};

// Helper: Validate task type specific fields
const validateTaskType = (taskTypeData, priority = 'low') => {
    const { task_name, start_date, end_date, start_time, end_time, recurrence, time_quota_hours, venue_id } = taskTypeData;

    // Check Business Hours (Rule 6)
    if (['Fixed Time Task', 'Floating Task', 'Recurring Task', 'Meeting'].includes(task_name)) {
        if (start_time && end_time) {
            const check = isWithinWorkHours(start_time, end_time, priority);
            if (!check.isWithin) {
                throw new Error(check.reason);
            }
        }
    }

    switch (task_name) {
        case 'Fixed Time Task':
            if (!start_time || !end_time) {
                throw new Error('Fixed Time Task requires start_time and end_time');
            }
            break;
        case 'Date-Only / Long Task':
        case 'Long Task':
            if (!start_date || !end_date) {
                throw new Error('Long Task requires start_date and end_date');
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
            if (!start_date || !end_date) {
                throw new Error('Recurring Task requires both start_date and end_date for expansion');
            }
            if (!start_time || !end_time) {
                throw new Error('Recurring Task requires start_time and end_time');
            }
            break;
        case 'Meeting':
            if (!start_time || !end_time || !venue_id) {
                throw new Error('Meeting requires start_time, end_time, and venue_id');
            }
            break;
        case 'Bidding / Nomination Task':
            if (!taskTypeData.max_acceptances || parseInt(taskTypeData.max_acceptances) <= 0) {
                throw new Error('Bidding Task requires a valid max_acceptances count');
            }
            break;
        case 'Self Log':
            if (!start_date) {
                throw new Error('Self Log requires start_date');
            }
            break;
        default:
            throw new Error(`Unknown task type: ${task_name}`);
    }
};

// Helper: Normalize Task Payload (Parse JSON strings, consolidate IDs, etc.)
const normalizeTaskPayload = async (body) => {
    let payload = { ...body };

    try {
        if (typeof payload.task_type_data === 'string') payload.task_type_data = JSON.parse(payload.task_type_data);
        if (typeof payload.assignee_ids === 'string') {
            try { payload.assignee_ids = JSON.parse(payload.assignee_ids); } catch (e) { payload.assignee_ids = [payload.assignee_ids]; }
        }
        if (typeof payload.assign_to_groups === 'string') payload.assign_to_groups = JSON.parse(payload.assign_to_groups);
        if (typeof payload.closure_ids === 'string') payload.closure_ids = JSON.parse(payload.closure_ids);
        if (typeof payload.sub_tasks === 'string') payload.sub_tasks = JSON.parse(payload.sub_tasks);
    } catch (e) {
        console.error('Payload Normalization Parsing error:', e);
    }

    // Consolidate assignee_id and assignee_ids
    let finalIds = [];
    if (payload.assignee_id) finalIds.push(parseInt(payload.assignee_id));
    if (payload.assignee_ids) {
        const ids = Array.isArray(payload.assignee_ids) ? payload.assignee_ids : [payload.assignee_ids];
        ids.forEach(id => {
            const numericId = parseInt(id);
            if (!isNaN(numericId) && !finalIds.includes(numericId)) finalIds.push(numericId);
        });
    }
    payload.assignee_ids = finalIds;

    // Faculty specific normalization & PK Resolution
    if (payload.facultyId && !payload.faculty_id) payload.faculty_id = payload.facultyId;
    if (payload.isFaculty !== undefined && payload.is_faculty === undefined) payload.is_faculty = payload.isFaculty;

    if (payload.faculty_id) {
        let facultyRecord = await Faculty.findByPk(payload.faculty_id);
        if (!facultyRecord) {
            facultyRecord = await Faculty.findOne({ where: { user_id: payload.faculty_id } });
        }
        if (facultyRecord) {
            payload.faculty_id = facultyRecord.id; // Resolve to PK
            payload.is_faculty = true; // Auto-infer
            
            // Add faculty user to assignees if not there
            if (facultyRecord.user_id) {
                const fUserId = facultyRecord.user_id * 1;
                if (!payload.assignee_ids.includes(fUserId)) {
                    payload.assignee_ids.push(fUserId);
                }
            }
        }
    }

    if (typeof payload.is_faculty === 'string') payload.is_faculty = (payload.is_faculty === 'true' || payload.is_faculty === '1');
    payload.is_faculty = !!payload.is_faculty;

    // Consistency: Map "Long Task" to canonical names
    if (payload.task_type_data && payload.task_type_data.task_name === 'Long Task') {
        payload.task_type_data.task_name = 'Date-Only / Long Task';
    }
    if (payload.task_type_data && payload.task_type_data.task_name === 'Bidding Task') {
        payload.task_type_data.task_name = 'Bidding / Nomination Task';
    }

    // Consolidate approver_id and approverId
    if (payload.approverId && !payload.approver_id) payload.approver_id = payload.approverId;
    if (payload.approver_id) payload.approver_id = parseInt(payload.approver_id) || null;

    // Normalization of booleans
    if (typeof payload.requires_approval === 'string') payload.requires_approval = (payload.requires_approval === 'true');
    else if (payload.approver == 1 || payload.approver === '1' || payload.approver === 'true') payload.requires_approval = true;
    else payload.requires_approval = !!payload.requires_approval;

    if (typeof payload.is_approved === 'string') payload.is_approved = payload.is_approved === 'true';
    if (typeof payload.is_mandatory === 'string') payload.is_mandatory = payload.is_mandatory === 'true';
    if (typeof payload.is_package === 'string') payload.is_package = payload.is_package === 'true';

    return payload;
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

        // Use normalization helper
        const payload = await normalizeTaskPayload(req.body);
        const {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            resource_id, is_faculty, faculty_id,
            task_type_data
        } = payload;

        // Validate required fields
        if (!title || !category || !priority) {
            return res.status(400).json({ message: 'Title, category, and priority are required' });
        }

        if (!task_type_data || !task_type_data.task_name) {
            return res.status(400).json({ message: 'Task type data with task_name is required' });
        }

        // Validate task type specific fields
        validateTaskType(task_type_data, priority);

        // Check if task date is Sunday (for single tasks created via this endpoint)
        if (task_type_data.start_date) {
            const startDate = new Date(task_type_data.start_date);
            if (startDate.getDay() === 0) {
                await t.rollback();
                return res.status(400).json({ message: 'Sunday is a holiday. Tasks cannot be assigned on Sundays.' });
            }
        }

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
            is_approved: true,
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
            recurrence: task_type_data.recurrence || 'none',
            max_acceptances: task_type_data.max_acceptances || null
        }, { transaction: t });

        await t.commit();

        await TaskLog.create({
            task_id: task.task_id,
            user_id: userId,
            action: 'create',
            details: `Task created: ${title}`
        });

        res.status(201).json({
            message: 'Task created successfully',
            task_id: task.task_id
        });

    } catch (error) {
        await t.rollback();
        if (error.message.includes('work hours')) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: error.message });
    }
};

// Get all tasks
exports.getAllTasks = async (req, res) => {
    try {
        const { task_title_id } = req.query;
        const where = { is_deleted: false };
        if (task_title_id) where.task_title_id = task_title_id;

        const tasks = await Task.findAndCountAll({
            where,
            attributes: ['task_id', 'title', 'description', 'category', 'priority', 'score', 'penalty_per_hour', 'is_approved', 'created_at', 'task_title_id'],
            include: [
                { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                { model: TaskType },
                { model: Faculty, attributes: ['name', 'department_id'] },
                { model: TaskTitle, attributes: ['id', 'task_title'] }
            ],
            limit,
            offset,
            order: [['task_id', 'DESC']]
        });
        res.json(getPagingData(tasks, page, limit));
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
                },
                {
                    model: Task,
                    as: 'Children',
                    include: [
                        { model: TaskType },
                        {
                            model: TaskAssign,
                            include: [{ model: User, attributes: ['user_id', 'role'] }]
                        }
                    ]
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

// Get exhaustive task details (history, logs, transfers, escalations)
exports.getExhaustiveTaskDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const task = await Task.findOne({
            where: { task_id: id, is_deleted: false },
            include: [
                { 
                    model: User, 
                    as: 'Creator', 
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'year', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Faculty, attributes: ['name', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                },
                { 
                    model: User, 
                    as: 'Approver', 
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'year', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Faculty, attributes: ['name', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                },
                { model: TaskType },
                { 
                    model: Venue, 
                    attributes: ['venue_id', 'name', 'location', 'venue_type'],
                    include: [{
                        model: RoleAssignment,
                        include: [
                            { 
                                model: User, 
                                attributes: ['user_id', 'role'],
                                include: [
                                    { model: Student, attributes: ['name'] },
                                    { model: Faculty, attributes: ['name'] },
                                    { model: Staff, attributes: ['name'] }
                                ]
                            }, 
                            { 
                                model: Role, 
                                attributes: ['user_role'],
                                where: { user_role: 'INCHARGE' }
                            }
                        ],
                        required: false
                    }]
                },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskAssign,
                    include: [{ 
                        model: User, 
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name', 'year', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                            { model: Faculty, attributes: ['name', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }]
                },
                {
                    model: TaskLog,
                    include: [{ 
                        model: User, 
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }],
                    required: false
                },
                {
                    model: TaskEscalation,
                    include: [
                        { 
                            model: User, as: 'Creator', attributes: ['user_id', 'role'],
                            include: [{ model: Student, attributes: ['name'] }, { model: Faculty, attributes: ['name'] }, { model: Staff, attributes: ['name'] }, { model: RoleUser, attributes: ['name'] }]
                        },
                        { 
                            model: User, as: 'RejectedUser', attributes: ['user_id', 'role'],
                            include: [{ model: Student, attributes: ['name'] }, { model: Faculty, attributes: ['name'] }, { model: Staff, attributes: ['name'] }, { model: RoleUser, attributes: ['name'] }]
                        }
                    ],
                    required: false
                },
                {
                    model: Task,
                    as: 'Children',
                    include: [
                        { model: TaskType },
                        {
                            model: TaskAssign,
                            include: [{ 
                                model: User, 
                                attributes: ['user_id', 'role'],
                                include: [
                                    { model: Student, attributes: ['name'] },
                                    { model: Faculty, attributes: ['name'] },
                                    { model: Staff, attributes: ['name'] },
                                    { model: RoleUser, attributes: ['name'] }
                                ]
                            }]
                        }
                    ],
                    required: false
                }
            ],
            order: [
                [TaskLog, 'created_at', 'ASC'], // Order logs chronologically
                [TaskEscalation, 'created_at', 'DESC'] // Order escalations newest first
            ]
        });

        if (!task) return res.status(404).json({ message: 'Task not found' });

        // Fetch Approval Request if applicable
        const approvalRequest = await TaskApprovalRequest.findOne({
            where: {
                [require('sequelize').Op.or]: [
                    { task_id: id },
                    { task_ids: { [require('sequelize').Op.like]: `%${id}%` } }
                ]
            },
            order: [['created_at', 'DESC']]
        });

        // Helper to format User profiles with all details
        const formatUserDetailed = (user) => {
            if (!user) return null;
            const profile = user.Student || user.Faculty || user.Staff || user.RoleUser || {};
            const dept = (user.Student?.Department || user.Faculty?.Department)?.name || 'N/A';
            
            return {
                user_id: user.user_id,
                role: user.role,
                name: profile.name || 'Unknown',
                year: user.Student?.year || 'N/A',
                department: dept
            };
        };

        const formatUserSimple = (user) => {
            if (!user) return null;
            const profile = user.Student || user.Faculty || user.Staff || user.RoleUser || {};
            return {
                user_id: user.user_id,
                role: user.role,
                name: profile.name || 'Unknown'
            };
        };

        const assignments_list = (task.TaskAssigns || []).map(a => ({
                assignment_id: a.id,
                assignee: formatUserDetailed(a.User),
                status: a.status,
                reason: a.reason,
                proof_url: a.proof,
                accepted_at: a.accepted_at,
                rejected_at: a.rejected_at,
                submitted_time: a.submitted_time,
                assigned_at: a.created_at
            }));

        // Group assignees
        const assignee_groups = {
            students: assignments_list.filter(a => a.assignee?.role === 'student').map(a => a.assignee),
            faculty: assignments_list.filter(a => a.assignee?.role === 'faculty').map(a => a.assignee),
            staff: assignments_list.filter(a => a.assignee?.role === 'staff').map(a => a.assignee),
            others: assignments_list.filter(a => !['student', 'faculty', 'staff'].includes(a.assignee?.role)).map(a => a.assignee)
        };

        // Venue details including Incharge
        const venue_incharges = (task.Venue?.RoleAssignments || []).map(ra => formatUserSimple(ra.User));

        // Execution status calculation
        const now = new Date();
        const taskType = task.TaskTypes?.[0];
        let execution_status = 'unknown';

        if (task.status === 'completed') {
            execution_status = 'completed';
        } else if (taskType) {
            const startDate = taskType.start_date ? new Date(taskType.start_date) : null;
            const endDate = taskType.end_date ? new Date(taskType.end_date) : null;
            const startTime = taskType.start_time;
            const endTime = taskType.end_time;

            // Simple date-based logic for now, more complex time logic could be added
            if (startDate && now < startDate) {
                execution_status = 'not_started';
            } else if (endDate && now > endDate) {
                execution_status = 'expired';
            } else {
                execution_status = 'alive';
            }
        }

        // Transfer history from logs
        const transfer_history = (task.TaskLogs || [])
            .filter(log => ['transfer', 'reject_and_transfer'].includes(log.action))
            .map(log => ({
                from_user: formatUserSimple(log.User),
                details: log.details,
                timestamp: log.created_at
            }));

        const formattedTask = {
            task_info: {
                task_id: task.task_id,
                title: task.title,
                description: task.description,
                category: task.category,
                priority: task.priority,
                status: task.status,
                execution_status,
                is_mandatory: task.is_mandatory,
                origin_type: task.origin_type,
                score: task.score,
                penalty_per_hour: task.penalty_per_hour,
                created_at: task.created_at,
                updated_at: task.updated_at
            },
            is_faculty_detail: task.is_faculty ? {
                is_faculty: true,
                faculty_id: task.faculty_id
                // Note: task.Faculty relation might exist if included in Task.findOne
            } : { is_faculty: false },
            schedule: taskType || null,
            venue: task.Venue ? {
                venue_id: task.Venue.venue_id,
                name: task.Venue.name,
                location: task.Venue.location,
                incharges: venue_incharges
            } : null,
            approval_detail: approvalRequest ? {
                request_id: approvalRequest.id,
                status: approvalRequest.status,
                approver_id: approvalRequest.approver_id,
                reason: approvalRequest.reason,
                created_at: approvalRequest.created_at
            } : (task.is_approved ? { status: 'approved' } : { status: 'pending' }),
            closure_methods: (task.TaskPackageClosures || []).map(c => c.TaskClosure?.name).filter(Boolean),
            assignees: {
                grouped: assignee_groups,
                all: assignments_list
            },
            people: {
                creator: formatUserDetailed(task.Creator),
                approver: formatUserDetailed(task.Approver)
            },
            history_logs: (task.TaskLogs || []).map(log => ({
                log_id: log.id,
                action: log.action,
                details: log.details,
                actor: formatUserSimple(log.User),
                timestamp: log.created_at
            })),
            transfer_history,
            escalations: (task.TaskEscalations || []).map(esc => ({
                escalation_id: esc.id,
                reason: esc.reason,
                message: esc.msg,
                status: esc.status,
                escalated_to: formatUserSimple(esc.Creator),
                escalated_about: formatUserSimple(esc.RejectedUser),
                is_read: esc.is_read,
                created_at: esc.created_at
            })),
            sub_tasks: (task.Children || []).map(child => ({
                task_id: child.task_id,
                title: child.title,
                status: child.status,
                schedule: child.TaskTypes?.[0] || null,
                assignments: (child.TaskAssigns || []).map(a => ({
                    assignee: formatUserSimple(a.User),
                    status: a.status
                }))
            }))
        };

        res.json(formattedTask);
    } catch (error) {
        console.error('Error in getExhaustiveTaskDetails:', error);
        res.status(500).json({ message: error.message });
    }
};

// Get tasks created by user
exports.getTasksCreatedByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit, offset, page } = getPagination(req.query);
        const tasks = await Task.findAndCountAll({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType },
                { model: TaskAssign, include: [{ model: User, attributes: ['user_id', 'role'] }] }
            ],
            limit,
            offset,
            order: [['task_id', 'DESC']]
        });
        res.json(getPagingData(tasks, page, limit));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get tasks assigned to user
exports.getTasksAssignedToUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit, offset, page } = getPagination(req.query);
        const assignments = await TaskAssign.findAndCountAll({
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
            ],
            limit,
            offset,
            order: [['id', 'DESC']] // TaskAssign typically uses 'id' for auto-increment PK
        });
        res.json(getPagingData(assignments, page, limit));
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
            where: {
                task_id: id,
                user_id: userId,
                status: { [require('sequelize').Op.in]: ['pending', 'accepted', 'in_progress'] }
            },
            include: [{
                model: Task,
                include: [{ model: TaskType }]
            }]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Eligible task assignment (pending or accepted) not found' });
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

        await TaskLog.create({
            task_id: id,
            user_id: userId,
            action: 'submit_proof',
            details: `Proof submitted: ${proofPath}`
        });

        res.json({
            message: 'Task submitted successfully',
            score_earned: earnedScore,
            penalty_applied: penalty,
            status: 'completed'
        });

        // Rule 8 & 11: Automatic Resume & Notifications
        (async () => {
            try {
                // 1. Notify Creator
                await Notification.create({
                    user_id: task.creator_id,
                    title: 'Task Completed',
                    msg: `User ${userId} completed "${task.title}".`,
                    type: 'task_completed'
                });

                // 2. Resume Paused Long Tasks for this user
                const pausedTasks = await TaskAssign.findAll({
                    where: { user_id: userId },
                    include: [{
                        model: Task,
                        where: { status: 'PAUSED', is_paused: true, is_deleted: false }
                    }]
                });

                for (const pausedAssign of pausedTasks) {
                    const pTask = pausedAssign.Task;
                    // Simply resume the first paused task found for the user
                    // (Or we could be more specific by checking overlap dates, but usually users have one background long task)
                    await pTask.update({ status: 'Active', is_paused: false });
                    await TaskLog.create({
                        task_id: pTask.task_id,
                        user_id: userId,
                        action: 'resume',
                        details: `Automatically resumed after completion of "${task.title}" at ${new Date().toISOString()}`
                    });

                    await Notification.create({
                        user_id: userId,
                        title: 'Task Resumed',
                        msg: `Background task "${pTask.title}" has been automatically resumed.`,
                        type: 'task_resumed'
                    });
                }
            } catch (notifyErr) {
                console.error('Post-completion background logic error:', notifyErr);
            }
        })();

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
        const { Op } = require('sequelize');

        if (!canCreateTask(userRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'You do not have permission to create tasks' });
        }

        // Use normalization helper
        const payload = await normalizeTaskPayload(req.body);
        let {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            is_approved, approver_id,
            resource_id, is_faculty, faculty_id,
            task_type_data,
            assignee_ids, // [1, 2, 3] or single ID
            assign_to_groups, // [ { role: 'STUDENT', department_id: 1 }, { role: 'STAFF' } ]
            closure_ids, // [1, 2]
            task_title_id, // NEW: ID of the master title
            origin_type, // 'directive' or 'self-log'
            sub_tasks, // NEW: [ { title, description, assignee_id, assignee_ids }, ... ]
            requires_approval // NEW: if true, task goes for approval before being created
        } = payload;

        // Normalization is now handled by normalizeTaskPayload helper

        // --- NEW: Category Normalization ---
        const categoryMap = {
            'Administrative': 'Admin',
            'administrative': 'Admin',
            'admin': 'Admin',
            'Academic': 'Academic',
            'academic': 'Academic',
            'Compliance': 'Compliance',
            'compliance': 'Compliance',
            'Others': 'Others',
            'others': 'Others'
        };
        if (category && categoryMap[category]) {
            category = categoryMap[category];
        } else if (category && (category.toLowerCase() === 'admin' || category.toLowerCase() === 'administrative')) {
            category = 'Admin';
        }

        // Force self-log for students/staff if not specified or as a restriction
        if (userRole?.toLowerCase() === 'student' || userRole?.toLowerCase() === 'staff') {
            origin_type = 'self-log';
            // Auto-assign to self if it's a self-log
            if (!assignee_ids) assignee_ids = [userId];
            else if (Array.isArray(assignee_ids) && !assignee_ids.includes(userId)) assignee_ids.push(userId);
            else if (typeof assignee_ids === 'number' && assignee_ids !== userId) assignee_ids = [assignee_ids, userId];
        }

        // Apply restrictions based on origin_type
        if (origin_type === 'self-log') {
            // Self-logs have no score or penalty
            score = 0;
            penalty_per_hour = 0;
        } else {
            // Directive tasks must have a future deadline
            const now = new Date();
            const endDateStr = task_type_data?.end_date || task_type_data?.start_date;
            if (endDateStr) {
                // Parse date carefully to avoid UTC shift issues
                // Using yyyy-MM-dd format with current local time components
                const deadline = new Date(endDateStr);
                const endTimeStr = task_type_data?.end_time || '23:59:59';
                const [hours, minutes] = endTimeStr.split(':');
                const h = parseInt(hours);
                const m = parseInt(minutes);
                if (!isNaN(h) && !isNaN(m)) {
                    deadline.setHours(h, m, 0, 0);

                    // Add a 5-minute buffer to accommodate slight clock drifts or slow page submissions
                    const bufferNow = new Date(now.getTime() - (5 * 60 * 1000));

                    if (deadline < bufferNow) {
                        await t.rollback();
                        return res.status(400).json({ message: 'Directive tasks must have a future deadline. For past activities, use Self-Log.' });
                    }
                }
            }
        }

        // Redundant parsing logic removed (handled by normalizeTaskPayload)

        // --- NEW: Handle Master Task Title ---
        if (task_title_id) {
            const masterTitle = await TaskTitle.findByPk(task_title_id);
            if (masterTitle) {
                title = title || masterTitle.task_title;
            }
        }

        if (!title || !category || !priority || !task_type_data || !task_type_data.task_name) {
            await t.rollback();
            return res.status(400).json({ message: 'Missing required task or type fields' });
        }

        if (requires_approval && !approver_id) {
            await t.rollback();
            return res.status(400).json({ message: 'Approver ID is required when task needs approval' });
        }

        validateTaskType(task_type_data, priority);

        // --- PRE-CALCULATE ASSIGNEES ---
        let finalAssigneeIds = [...assignee_ids];

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
                            where: { role_id: hodRole.role_id, ...(department_id && { department_id }) }
                        });
                        users = ra;
                    }
                } else if (role === 'STAFF') {
                    users = await Staff.findAll();
                } else {
                    const targetRole = await Role.findOne({ where: { user_role: role } });
                    if (targetRole) {
                        const ra = await RoleAssignment.findAll({
                            where: { role_id: targetRole.role_id, ...(department_id && { department_id }) }
                        });
                        users = ra;
                    }
                }
                users.forEach(u => { if (u.user_id && !finalAssigneeIds.includes(u.user_id * 1)) finalAssigneeIds.push(u.user_id * 1); });
            }
        }

        // --- NEW: Faculty Ownership Logic (Unified with normalization) ---
        let facultyUserId = null;
        if (is_faculty && faculty_id) {
            const facultyRecord = await Faculty.findByPk(faculty_id);
            if (facultyRecord && facultyRecord.user_id) {
                facultyUserId = facultyRecord.user_id * 1;
                // Redundant check since normalizeTaskPayload already adds it, 
                // but good for safety if assignee_ids were cleared somehow.
                if (!finalAssigneeIds.includes(facultyUserId)) {
                    finalAssigneeIds.push(facultyUserId);
                }
            }
        }

        if (req.file) {
            try {
                const workbook = XLSX.readFile(req.file.path);
                const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                for (const row of data) {
                    const { email, user_id } = row;
                    let excelUserId = user_id;
                    if (!excelUserId && email) {
                        const profiles = await Promise.all([
                            Student.findOne({ where: { email } }),
                            Faculty.findOne({ where: { email } }),
                            RoleUser.findOne({ where: { email } }),
                            Staff.findOne({ where: { email } })
                        ]);
                        excelUserId = profiles.find(p => p)?.user_id;
                    }
                    if (excelUserId) {
                        const numericId = parseInt(excelUserId);
                        if (!isNaN(numericId) && !finalAssigneeIds.includes(numericId)) finalAssigneeIds.push(numericId);
                    }
                }
            } catch (e) { console.error('Excel processing error:', e); }
        }

        // --- NEW: Add Sub-task Assignees to Parent if it's a Package ---
        if (is_package && sub_tasks && Array.isArray(sub_tasks)) {
            for (const sub of sub_tasks) {
                if (sub.assignee_id) {
                    const sid = parseInt(sub.assignee_id);
                    if (!isNaN(sid) && !finalAssigneeIds.includes(sid)) finalAssigneeIds.push(sid);
                }
                if (sub.assignee_ids && Array.isArray(sub.assignee_ids)) {
                    sub.assignee_ids.forEach(sid => {
                        const numericId = parseInt(sid);
                        if (!isNaN(numericId) && !finalAssigneeIds.includes(numericId)) finalAssigneeIds.push(numericId);
                    });
                }
            }
        }

        // --- BATCH FETCH ASSIGNEE ROLES ---
        const allInvolvedIds = [...finalAssigneeIds];
        const roleMap = {};
        if (allInvolvedIds.length > 0) {
            const assigneeProfiles = await User.findAll({
                where: { user_id: { [Op.in]: allInvolvedIds } },
                attributes: ['user_id', 'role']
            });
            assigneeProfiles.forEach(u => { roleMap[u.user_id] = u.role; });
        }

        // --- CALCULATE DATES FOR EXPANSION ---
        const occurrenceDates = [];
        const start = new Date(task_type_data.start_date);
        const end = task_type_data.end_date ? new Date(task_type_data.end_date) : start;
        const recurrence = task_type_data.recurrence || 'none';

        if (task_type_data.task_name === 'Recurring Task' && recurrence !== 'none') {
            let current = new Date(start);
            while (current <= end) {
                // Skip Sundays for daily Recurring tasks if that was the intent,
                // but user said "each day" so I will include them for now 
                // unless it's a legacy requirement. 
                // Actually, I'll keep the skip for now to avoid breaking changes 
                // unless they explicitly ask to include Sundays.
                if (current.getDay() !== 0) {
                    occurrenceDates.push(new Date(current));
                }

                if (recurrence === 'daily') current.setDate(current.getDate() + 1);
                else if (recurrence === 'weekly') current.setDate(current.getDate() + 7);
                else if (recurrence === 'monthly') current.setMonth(current.getMonth() + 1);
                else break;

                // Safety limit: Max 365 occurrences per creation
                if (occurrenceDates.length >= 365) break;
            }
        } else {
            occurrenceDates.push(start);
        }

        // Rule 10: Preliminary Recurring Conflict Check (Optional/Proposed)
        // We'll handle this during the per-assignee assignment loop below for better precision.

        // --- BATCH CREATION ---
        const createdTaskIds = [];

        for (const oDate of occurrenceDates) {
            // 1. Create Parent Task
            const parentTask = await Task.create({
                title, description, category, priority,
                task_title_id: task_title_id || null,
                is_package: is_package || false,
                venue_id: venue_id || null,
                is_pause_allowed: is_pause_allowed || false,
                score: score || 0,
                penalty_per_hour: penalty_per_hour || 0,
                is_document: is_document || false,
                is_mandatory: is_mandatory || false,
                is_approved: requires_approval ? false : true,
                approver_id: approver_id || null,
                resource_id: resource_id || null,
                is_faculty: is_faculty || false,
                faculty_id: faculty_id || null,
                creator_id: userId,
                origin_type: origin_type || 'directive',
                status: requires_approval ? 'Pending Approval' : 'Active'
            }, { transaction: t });

            createdTaskIds.push(parentTask.task_id);

            // 2. Create TaskType for Parent
            await TaskType.create({
                task_id: parentTask.task_id,
                task_name: task_type_data.task_name,
                start_date: oDate,
                // For Recurring tasks, end_date is same as start_date (single day occurrence)
                // For Long Tasks / Floating Tasks, preserve the original end_date
                end_date: (task_type_data.task_name === 'Recurring Task') ? oDate : (task_type_data.end_date || oDate),
                start_time: task_type_data.start_time || null,
                end_time: task_type_data.end_time || null,
                time_quota_hours: task_type_data.time_quota_hours || null,
                venue_id: task_type_data.venue_id || null,
                recurrence: 'none',
                max_acceptances: task_type_data.max_acceptances || null
            }, { transaction: t });

            // 4. Parent Task Assignment (to main assignees) - ONLY if not waiting for approval
            if (!requires_approval && finalAssigneeIds.length > 0) {
                const assignments = [];
                for (const assigneeId of finalAssigneeIds) {
                    // Skip if user was not found during batch fetch (e.g. non-existent or deleted)
                    if (!roleMap[assigneeId]) {
                        console.warn(`[createUnifiedTask] Skipping invalid/deleted assignee ID: ${assigneeId}`);
                        continue;
                    }

                    const allowed = await canAssignTo(userId, assigneeId);
                    const assigneeRole = roleMap[assigneeId];
                    const isStaff = assigneeRole === 'staff';
                    const isFacultySupervisor = (assigneeId === facultyUserId);
                    // Faculty supervisor only auto-accepts if they are the creator
                    const facultyAutoAccept = isFacultySupervisor && (facultyUserId === userId);
                    const autoAccept = is_mandatory || isStaff || facultyAutoAccept;

                    if (allowed) {
                        let finalStatus = autoAccept ? 'accepted' : 'pending';
                        let finalAcceptedAt = autoAccept ? new Date() : null;

                        // If it's mandatory, check for overlap before auto-accepting
                        if (autoAccept) {
                            // 1. Daily Task Limit Check
                            const dailyCount = await TaskAssign.count({
                                where: { user_id: assigneeId, status: { [Op.in]: ['accepted', 'in_progress'] } },
                                include: [{
                                    model: Task,
                                    required: true,
                                    include: [{ model: TaskType, where: { start_date: oDate } }]
                                }]
                            });

                            if (dailyCount >= MAX_DAILY_TASKS) {
                                finalStatus = 'pending';
                                finalAcceptedAt = null;
                                await TaskEscalation.create({
                                    task_id: parentTask.task_id,
                                    reason: 'Daily Task Limit Reached',
                                    msg: `User ${assigneeId} already has ${MAX_DAILY_TASKS} tasks for ${oDate}. Auto-acceptance failed.`,
                                    creator_id: userId,
                                    rejected_user_id: assigneeId,
                                    status: 'pending'
                                }, { transaction: t });
                            } else {
                                const overlap = await checkTaskOverlap(assigneeId, {
                                    start_date: oDate,
                                    end_date: (task_type_data.task_name === 'Recurring Task') ? oDate : (task_type_data.end_date || oDate),
                                    start_time: task_type_data.start_time,
                                    end_time: task_type_data.end_time,
                                    task_name: task_type_data.task_name,
                                    priority: priority
                                }, parentTask.task_id);

                                if (overlap.hasConflict) {
                                    finalStatus = 'pending';
                                    finalAcceptedAt = null;

                                    if (overlap.type === 'priority_override') {
                                        // Higher priority task can request override
                                        await TaskEscalation.create({
                                            task_id: parentTask.task_id,
                                            reason: `Priority Override Requested`,
                                            msg: `Task "${title}" (${priority}) requests to override "${overlap.conflictTask.title}" (${overlap.conflictTask.priority}) for User ${assigneeId}.`,
                                            creator_id: userId,
                                            rejected_user_id: assigneeId,
                                            status: 'pending'
                                        }, { transaction: t });

                                        await Notification.create({
                                            user_id: userId,
                                            title: 'Priority Override Potential',
                                            msg: `Your task "${title}" can override "${overlap.conflictTask.title}" for User ${assigneeId}. Approval required.`,
                                            type: 'priority_override_request'
                                        }, { transaction: t });
                                    } else {
                                        // Rule 10: Shift/Skip for Recurring Tasks
                                        if (task_type_data.task_name === 'Recurring Task') {
                                            console.log(`Skipping recurring instance for user ${assigneeId} due to conflict.`);
                                            continue; // Skip assignment for this user on this date
                                        }

                                        await TaskEscalation.create({
                                            task_id: parentTask.task_id,
                                            reason: overlap.type === 'work_hours' ? 'Work Hours Violation' : 'Conflict: Mandatory Task Blocked',
                                            msg: overlap.reason || `Conflict for User ${assigneeId} with "${overlap.conflictTask?.title}".`,
                                            creator_id: userId,
                                            rejected_user_id: assigneeId,
                                            status: 'pending'
                                        }, { transaction: t });
                                    }
                                }
                            }
                        }

                        assignments.push({
                            task_id: parentTask.task_id,
                            user_id: assigneeId,
                            status: finalStatus,
                            accepted_at: finalAcceptedAt
                        });

                        await Notification.create({
                            user_id: assigneeId,
                            title: 'New Task Assigned',
                            msg: `You have been assigned a new task: ${title}`,
                            type: 'task_created'
                        }, { transaction: t });
                    }
                }
                if (assignments.length > 0) {
                    await TaskAssign.bulkCreate(assignments, { transaction: t, ignoreDuplicates: true });
                }
            }

            // 4. Handle Sub-Tasks (Child Tasks)
            if (is_package && sub_tasks && Array.isArray(sub_tasks)) {
                let sequenceOrder = 1;
                for (const sub of sub_tasks) {
                    const childTask = await Task.create({
                        title: sub.title || `Sub-task for ${title}`,
                        description: sub.description || description,
                        category: category,
                        priority: priority,
                        is_package: false,
                        parent_task_id: parentTask.task_id,
                        venue_id: sub.venue_id || venue_id || null,
                        score: sub.score || 0,
                        penalty_per_hour: sub.penalty_per_hour || 0,
                        is_document: sub.is_document || is_document || false,
                        is_mandatory: sub.is_mandatory || is_mandatory || false,
                        is_approved: requires_approval ? false : true,
                        approver_id: requires_approval ? approver_id : null,
                        creator_id: userId,
                        sequence_order: sequenceOrder++,
                        origin_type: origin_type || 'directive',
                        status: requires_approval ? 'Pending Approval' : 'Active'
                    }, { transaction: t });

                    await TaskType.create({
                        task_id: childTask.task_id,
                        task_name: sub.task_name || 'Fixed Time Task',
                        start_date: sub.start_date || oDate,
                        end_date: sub.end_date || oDate,
                        start_time: sub.start_time || task_type_data.start_time || null,
                        end_time: sub.end_time || task_type_data.end_time || null,
                        max_duration_hours: sub.max_duration_hours || null,
                        venue_id: sub.venue_id || venue_id || null,
                        recurrence: 'none'
                    }, { transaction: t });

                    // Assign sub-task to specific people
                    const subAssigneeIds = [];
                    if (sub.assignee_id) {
                        const sid = parseInt(sub.assignee_id);
                        if (!isNaN(sid)) subAssigneeIds.push(sid);
                    }
                    if (sub.assignee_ids && Array.isArray(sub.assignee_ids)) {
                        sub.assignee_ids.forEach(sid => {
                            const numericId = parseInt(sid);
                            if (!isNaN(numericId) && !subAssigneeIds.includes(numericId)) subAssigneeIds.push(numericId);
                        });
                    }

                    if (!requires_approval && subAssigneeIds.length > 0) {
                        const childAssignments = [];
                        for (const sid of subAssigneeIds) {
                            // Skip if user was not found during batch fetch
                            if (!roleMap[sid]) {
                                console.warn(`[createUnifiedTask] Skipping invalid sub-assignee ID: ${sid}`);
                                continue;
                            }
                            const allowedChild = await canAssignTo(userId, sid);
                            if (!allowedChild) {
                                console.warn(`Assignment to user ${sid} for sub-task ${sub.title} skipped due to permissions.`);
                                continue;
                            }

                            const isChildStaff = roleMap[sid] === 'staff';
                            const childAutoAccept = sub.is_mandatory || isChildStaff;

                            let finalChildStatus = childAutoAccept ? 'accepted' : 'pending';
                            let finalChildAcceptedAt = childAutoAccept ? new Date() : null;

                            // Determine if sub-task should be queued (sequential logic for non-students)
                            const isStudent = roleMap[sid] === 'student';

                            // SEQUENTIAL LOGIC: Only the first sub-task is active/pending; others are 'queued' for non-students
                            if (childTask.sequence_order > 1 && !isStudent) {
                                finalChildStatus = 'queued';
                                finalChildAcceptedAt = null;
                            }

                            if (childAutoAccept) {
                                // 1. Daily Task Limit Check
                                const childDailyCount = await TaskAssign.count({
                                    where: { user_id: sid, status: { [Op.in]: ['accepted', 'in_progress'] } },
                                    include: [{
                                        model: Task,
                                        required: true,
                                        include: [{ model: TaskType, where: { start_date: sub.start_date || oDate } }]
                                    }]
                                });

                                if (childDailyCount >= MAX_DAILY_TASKS) {
                                    finalChildStatus = 'pending';
                                    finalChildAcceptedAt = null;
                                    await TaskEscalation.create({
                                        task_id: childTask.task_id,
                                        reason: 'Daily Task Limit Reached',
                                        msg: `User ${sid} already has ${MAX_DAILY_TASKS} tasks for ${oDate}. Auto-acceptance failed for sub-task.`,
                                        creator_id: userId,
                                        rejected_user_id: sid,
                                        status: 'pending'
                                    }, { transaction: t });
                                } else {
                                    const overlapChild = await checkTaskOverlap(sid, {
                                        start_date: sub.start_date || oDate,
                                        end_date: sub.end_date || oDate,
                                        start_time: sub.start_time || task_type_data.start_time,
                                        end_time: sub.end_time || task_type_data.end_time,
                                        task_name: sub.task_name || 'Fixed Time Task',
                                        priority: priority
                                    }, childTask.task_id);

                                    if (overlapChild.hasConflict) {
                                        finalChildStatus = 'pending';
                                        finalChildAcceptedAt = null;

                                        if (overlapChild.type === 'priority_override') {
                                            await TaskEscalation.create({
                                                task_id: childTask.task_id,
                                                reason: `Priority Override Requested (Sub-task)`,
                                                msg: `Sub-task "${childTask.title}" (${priority}) requests to override "${overlapChild.conflictTask.title}" for User ${sid}.`,
                                                creator_id: userId,
                                                rejected_user_id: sid,
                                                status: 'pending'
                                            }, { transaction: t });
                                        } else {
                                            await TaskEscalation.create({
                                                task_id: childTask.task_id,
                                                reason: overlapChild.type === 'work_hours' ? 'Work Hours Violation' : 'Conflict: Mandatory Sub-task Blocked',
                                                msg: overlapChild.reason || `Sub-task Conflict for User ${sid} with "${overlapChild.conflictTask?.title}".`,
                                                creator_id: userId,
                                                rejected_user_id: sid,
                                                status: 'pending'
                                            }, { transaction: t });
                                        }
                                    }
                                }
                            }

                            childAssignments.push({
                                task_id: childTask.task_id,
                                user_id: sid,
                                status: finalChildStatus,
                                accepted_at: finalChildAcceptedAt
                            });

                            if (finalChildStatus !== 'queued') {
                                await Notification.create({
                                    user_id: sid,
                                    title: 'New Sub-task Assigned',
                                    msg: `You have been assigned a sub-task: ${sub.title} within ${title}`,
                                    type: 'task_created'
                                }, { transaction: t });
                            }
                        }

                        if (childAssignments.length > 0) {
                            await TaskAssign.bulkCreate(childAssignments, { transaction: t, ignoreDuplicates: true });
                        }
                    }
                }
            }

            // 5. Venue Logic (Special Permission/Assignment for Incharge) - ONLY IF NOT WAITING FOR APPROVAL
            if (!requires_approval && venue_id) {
                const inchargers = await RoleAssignment.findAll({
                    where: { venue_id },
                    include: [{ model: Role, where: { user_role: { [Op.like]: '%INCHARGE%' } } }]
                });

                for (const ra of inchargers) {
                    if (!ra.user_id) continue;
                    const alreadyAssigned = finalAssigneeIds.includes(ra.user_id * 1);
                    if (!alreadyAssigned) {
                        if (is_package) {
                            const venueTask = await Task.create({
                                title: `Permission: ${title} at Venue`,
                                description: `Approval required for venue reservation.`,
                                category: 'Admin',
                                priority: 'high',
                                is_package: false,
                                parent_task_id: parentTask.task_id,
                                venue_id: venue_id,
                                creator_id: userId,
                                status: 'Active'
                            }, { transaction: t });

                            await TaskType.create({
                                task_id: venueTask.task_id,
                                task_name: 'Permission Request',
                                start_date: oDate,
                                end_date: oDate,
                                start_time: task_type_data.start_time,
                                end_time: task_type_data.end_time,
                                venue_id: venue_id,
                                recurrence: 'none'
                            }, { transaction: t });

                            await TaskAssign.create({
                                task_id: venueTask.task_id,
                                user_id: ra.user_id,
                                status: 'pending'
                            }, { transaction: t });
                        } else {
                            await TaskAssign.create({
                                task_id: parentTask.task_id,
                                user_id: ra.user_id,
                                status: 'pending'
                            }, { transaction: t });
                        }

                        await Notification.create({
                            user_id: ra.user_id,
                            title: 'Venue Booking Requires Your Approval',
                            msg: `A new booking "${title}" has been requested for your venue.`,
                            type: 'task_created'
                        }, { transaction: t });
                    }
                }
            }

            // 6. Notify Creator
            await Notification.create({
                user_id: userId,
                title: 'Task Created Successfully',
                msg: `Task "${title}" ${is_package ? 'and its sub-tasks' : ''} have been created.`,
                type: 'task_created'
            }, { transaction: t });

            // 7. Handle Self-Log - ONLY IF NOT WAITING FOR APPROVAL
            if (!requires_approval && origin_type === 'self-log') {
                const submittedTime = task_type_data.start_date ? new Date(task_type_data.start_date) : new Date();
                if (task_type_data.start_time) {
                    const [h, m] = task_type_data.start_time.split(':');
                    submittedTime.setHours(parseInt(h), parseInt(m), 0, 0);
                }

                await TaskAssign.upsert({
                    task_id: parentTask.task_id,
                    user_id: userId,
                    status: 'completed',
                    accepted_at: submittedTime,
                    submitted_time: submittedTime,
                    earned_score: 0,
                    penalty_applied: 0
                }, { transaction: t });
            }

            // 8. Closure Rules
            if (closure_ids && Array.isArray(closure_ids)) {
                const closures = closure_ids.map(cid => ({ task_id: parentTask.task_id, closure_id: cid }));
                await TaskPackageClosure.bulkCreate(closures, { transaction: t });
            }
        }

        // --- APPROVAL GATE AFTERCARE ---
        if (requires_approval) {
            const { TaskApprovalRequest, Notification, TaskAssign } = require('../models');

            // 1. Create Approval Request
            const savedRequest = await TaskApprovalRequest.create({
                approver_id: approver_id,
                creator_id: userId,
                task_payload: payload,
                task_id: createdTaskIds[0],
                task_ids: createdTaskIds,
                status: 'pending'
            }, { transaction: t });

            await Notification.create({
                user_id: approver_id,
                title: 'Task Approval Required',
                msg: `A new task "${title}" requires your approval.`,
                type: 'task_approval_request'
            }, { transaction: t });

            await t.commit();
            return res.status(202).json({
                message: 'Task created and awaiting approval. It is visible in your pending list.',
                task_id: createdTaskIds[0],
                approval_request_id: savedRequest.id
            });
        }

        await t.commit();

        await TaskLog.create({
            task_id: createdTaskIds[0], // Log the first one at least for the series
            user_id: userId,
            action: 'create_unified',
            details: `Unified task series created: ${title}. Count: ${occurrenceDates.length}`
        });

        res.status(201).json({
            message: `Successfully created ${occurrenceDates.length} occurrences for the task series.`,
            task_ids: createdTaskIds,
            occurrences: occurrenceDates.length,
            assigned_count: finalAssigneeIds.length
        });

    } catch (error) {
        await t.rollback();
        console.error('Error in createUnifiedTask:', error);

        // Return 400 for validation errors or explicit check failures
        if (error.message.includes('requires') || error.message.includes('fields') || error.message.includes('deadline') || error.message.includes('work hours')) {
            return res.status(400).json({ message: error.message });
        }

        res.status(500).json({ message: error.message });
    }
}; // end createUnifiedTask

// Finalize a task after approval (Create assignments and notify)
exports.finalizeTaskAssignments = async (approvalRequest, transaction = null) => {
    const { Task, TaskAssign, Notification, User, RoleAssignment, Role, TaskType } = require('../models');
    const { Op } = require('sequelize');
    const t = transaction || await Task.sequelize.transaction();

    try {
        const payload = await normalizeTaskPayload(approvalRequest.task_payload);
        const taskIds = approvalRequest.task_ids || [approvalRequest.task_id];

        // 1. Update all tasks to Active and Approved
        await Task.update({
            is_approved: true,
            status: 'Active'
        }, {
            where: { task_id: taskIds },
            transaction: t
        });

        // 2. Fetch one task to get common details if needed
        const sampleTask = await Task.findByPk(taskIds[0], { transaction: t });
        const title = sampleTask.title;
        const userId = sampleTask.creator_id;
        const approverId = approvalRequest.approver_id;

        // --- NEW: Update Approver's Assignment Status ---
        if (approverId) {
            await TaskAssign.update({
                status: 'accepted'
            }, {
                where: {
                    task_id: taskIds,
                    user_id: approverId
                },
                transaction: t
            });
        }

        // 3. Process Assignments for each task occurrence
        for (const taskId of taskIds) {
            // Get finalAssigneeIds (Already normalized in payload)
            let finalAssigneeIds = [...(payload.assignee_ids || [])];

            // Logic for sub-tasks if package
            if (payload.is_package && payload.sub_tasks) {
                // Find child tasks
                const childTasks = await Task.findAll({ where: { parent_task_id: taskId }, transaction: t });

                for (const sub of payload.sub_tasks) {
                    const childTask = childTasks.find(ct => ct.title === (sub.title || `Sub-task for ${title}`));
                    if (!childTask) continue;

                    // Update child task
                    await childTask.update({ is_approved: true, status: 'Active' }, { transaction: t });

                    const subAssigneeIds = [];
                    if (sub.assignee_id) subAssigneeIds.push(parseInt(sub.assignee_id));
                    if (sub.assignee_ids) sub.assignee_ids.forEach(id => subAssigneeIds.push(parseInt(id)));

                    for (const sid of [...new Set(subAssigneeIds)]) {
                        if (isNaN(sid)) continue;
                        await TaskAssign.create({
                            task_id: childTask.task_id,
                            user_id: sid,
                            status: 'pending'
                        }, { transaction: t });

                        await Notification.create({
                            user_id: sid,
                            title: 'New Task Assigned',
                            msg: `You have been assigned a new sub-task: ${childTask.title}`,
                            type: 'task_created'
                        }, { transaction: t });
                    }
                }
            }

            // Main task assignments
            for (const assigneeId of finalAssigneeIds) {
                await TaskAssign.create({
                    task_id: taskId,
                    user_id: assigneeId,
                    status: 'pending' // Should check roles for auto-accept? For simplicity, pending.
                }, { transaction: t });

                await Notification.create({
                    user_id: assigneeId,
                    title: 'New Task Assigned (Approved)',
                    msg: `A task "${title}" has been approved and assigned to you.`,
                    type: 'task_created'
                }, { transaction: t });
            }

            // --- NEW: Post-Approval Venue Incharge Logic ---
            if (payload.venue_id) {
                const venue_id = payload.venue_id;
                const currentTask = await Task.findByPk(taskId, { include: [TaskType], transaction: t });
                const taskType = currentTask.TaskTypes?.[0]; // Get date/time from the task itself

                const inchargers = await RoleAssignment.findAll({
                    where: { venue_id },
                    include: [{ model: Role, where: { user_role: { [Op.like]: '%INCHARGE%' } } }],
                    transaction: t
                });

                for (const ra of inchargers) {
                    if (!ra.user_id) continue;
                    // Skip if already assigned in main loop
                    if (finalAssigneeIds.includes(ra.user_id * 1)) continue;

                    if (payload.is_package) {
                        const venueTask = await Task.create({
                            title: `Permission: ${title} at Venue`,
                            description: `Approval required for venue reservation.`,
                            category: 'Admin',
                            priority: 'high',
                            is_package: false,
                            parent_task_id: taskId,
                            venue_id: venue_id,
                            creator_id: userId,
                            status: 'Active'
                        }, { transaction: t });

                        if (taskType) {
                            await TaskType.create({
                                task_id: venueTask.task_id,
                                task_name: 'Permission Request',
                                start_date: taskType.start_date,
                                end_date: taskType.end_date,
                                start_time: taskType.start_time,
                                end_time: taskType.end_time,
                                venue_id: venue_id,
                                recurrence: 'none'
                            }, { transaction: t });
                        }

                        await TaskAssign.create({
                            task_id: venueTask.task_id,
                            user_id: ra.user_id,
                            status: 'pending'
                        }, { transaction: t });
                    } else {
                        await TaskAssign.create({
                            task_id: taskId,
                            user_id: ra.user_id,
                            status: 'pending'
                        }, { transaction: t });
                    }

                    await Notification.create({
                        user_id: ra.user_id,
                        title: 'Venue Booking Requires Your Approval',
                        msg: `A new booking "${title}" (Approved by higher authority) has been requested for your venue.`,
                        type: 'task_created'
                    }, { transaction: t });
                }
            }

            // --- NEW: Post-Approval Self-Log Logic ---
            if (payload.origin_type === 'self-log') {
                const taskTypeData = payload.task_type_data || {};
                const submittedTime = taskTypeData.start_date ? new Date(taskTypeData.start_date) : new Date();
                if (taskTypeData.start_time) {
                    const [h, m] = taskTypeData.start_time.split(':');
                    submittedTime.setHours(parseInt(h), parseInt(m), 0, 0);
                }

                await TaskAssign.upsert({
                    task_id: taskId,
                    user_id: userId,
                    status: 'completed',
                    accepted_at: submittedTime,
                    submitted_time: submittedTime,
                    earned_score: 0,
                    penalty_applied: 0
                }, { transaction: t });
            }
        }

        if (!transaction) await t.commit();

        // Notify Creator
        await Notification.create({
            user_id: userId,
            title: 'Task Approved',
            msg: `Your task "${title}" has been approved and activated.`,
            type: 'task_created'
        });

        return true;
    } catch (error) {
        if (!transaction) await t.rollback();
        throw error;
    }
};

// Core task creation logic exposed for internal replay
exports.createUnifiedTaskCore = async (payload, overrideCreatorId, overrideUserRole) => {
    return new Promise((resolve, reject) => {
        const fakeReq = {
            body: { ...payload, requires_approval: false },
            userId: overrideCreatorId,
            userRole: overrideUserRole || 'faculty', // Approvers trigger as the original creator's role
            file: null
        };
        const fakeRes = {
            status(code) { this._code = code; return this; },
            json(data) {
                if (this._code && this._code >= 400) {
                    reject(new Error(data.message || 'Task creation failed'));
                } else {
                    resolve(data);
                }
            }
        };
        exports.createUnifiedTask(fakeReq, fakeRes);
    });
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

        const payload = await normalizeTaskPayload(req.body);
        const {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            is_approved, approver_id, resource_id, is_faculty, faculty_id,
            status, task_type_data,
            task_title_id // NEW: support for updating master title link
        } = payload;

        // If task_title_id is changing, we might want to update the title too
        let updateTitle = title || task.title;
        if (task_title_id && task_title_id !== task.task_title_id && !title) {
            const masterTitle = await TaskTitle.findByPk(task_title_id);
            if (masterTitle) updateTitle = masterTitle.task_title;
        }

        let finalFacultyId = faculty_id !== undefined ? faculty_id : task.faculty_id;
        if (is_faculty && finalFacultyId) {
            let facultyRecord = await Faculty.findByPk(finalFacultyId);
            if (!facultyRecord) {
                facultyRecord = await Faculty.findOne({ where: { user_id: finalFacultyId } });
            }
            if (facultyRecord) {
                finalFacultyId = facultyRecord.id;
            }
        }

        // Update basic task fields
        await task.update({
            title: updateTitle,
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
            faculty_id: finalFacultyId,
            status: status || task.status,
            task_title_id: task_title_id !== undefined ? task_title_id : task.task_title_id
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
        const userRole = req.userRole;
        const { TaskPackageClosure, TaskClosure, TaskOTP } = require('../models');

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

        const profileTotalScore = profile ? parseFloat(profile.total_score || 0) : 0;
        const profileNetScore = profile ? parseFloat(profile.score || 0) : 0;
        // Fix: Use Math.max between profile.penalty and (total - net) to catch hidden penalties
        const profileTotalPenalty = profile ? Math.max(parseFloat(profile.penalty || 0), profileTotalScore - profileNetScore) : 0;

        // Fetch all assignments for the user
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    { model: TaskType },
                    {
                        model: TaskPackageClosure,
                        required: false,
                        include: [{ model: TaskClosure, attributes: ['name'] }]
                    },
                    { model: TaskOTP, required: false }
                ]
            }],
            order: [['submitted_time', 'DESC']]
        });

        // Initialize last 7 days with 0
        const dailyStats = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(firstDay);
            d.setDate(firstDay.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            dailyStats[dateStr] = 0;
        }

        let tasksBaseSum = 0;
        let tasksEarnedSum = 0;
        let tasksPenaltySum = 0;
        const taskDetails = [];

        for (const a of assignments) {
            if (!a.Task || a.status !== 'completed') continue;

            const task = a.Task;
            const closures = task.TaskPackageClosures || [];

            const baseScore = parseFloat(task.score || 0);
            const earnedScore = parseFloat(a.earned_score || 0);
            const penalty = parseFloat(a.penalty_applied || 0);

            tasksBaseSum += baseScore;
            tasksEarnedSum += earnedScore;
            tasksPenaltySum += penalty;

            if (a.submitted_time) {
                const d = new Date(a.submitted_time);
                if (!isNaN(d.getTime())) {
                    const submittedDate = d.toISOString().split('T')[0];
                    if (dailyStats.hasOwnProperty(submittedDate)) {
                        dailyStats[submittedDate] += earnedScore;
                    }
                }
            }

            if (baseScore > 0 || penalty > 0) {
                taskDetails.push({
                    task_id: a.task_id,
                    title: task.title,
                    status: a.status,
                    base_score: baseScore,
                    earned_score: earnedScore,
                    penalty_applied: penalty,
                    submitted_time: a.submitted_time,
                    proof: a.proof || null,
                    required_closures: closures.map(c => c.TaskClosure?.name).filter(Boolean),
                    submission_type: penalty > 0 ? 'Late Submission' : 'Perfect Submission'
                });
            }
        }

        // ACCOUNT FOR LEGACY/INITIAL SCORES (Discrepancy Check)
        // If profile sums > task sums, it means there was an initial balance from bulk upload
        const initialBase = Math.max(0, profileTotalScore - tasksBaseSum);
        // Note: earned score captures the net including initial penalty if any
        const initialEarned = Math.max(0, profileNetScore - tasksEarnedSum);
        const initialPenalty = Math.max(0, profileTotalPenalty - tasksPenaltySum);

        if (initialBase > 0 || initialPenalty > 0 || initialEarned > 0) {
            taskDetails.push({
                task_id: 0,
                title: "Opening Balance / Initial Credits",
                status: "completed",
                base_score: initialBase,
                earned_score: initialEarned,
                penalty_applied: initialPenalty,
                submitted_time: profile?.created_at || null,
                proof: null,
                required_closures: [],
                submission_type: "Initial/Bulk Upload"
            });
        }

        const last7Days = Object.keys(dailyStats).map(date => ({
            date,
            score: dailyStats[date]
        }));

        res.json({
            total_score: profileTotalScore,
            total_penalty: profileTotalPenalty,
            earned_score: profileNetScore,
            last_7_days: last7Days,
            task_details: taskDetails
        });

    } catch (error) {
        console.error("Critical error in getUserTaskStats:", error);
        res.status(500).json({ message: error.message });
    }
};


// Comprehensive Student Dashboard API
exports.getStudentDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        // 1. Setup Date logic (IST)
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const today = new Date(localNow);
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Helper: safe local date string
        const toLocalISO = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const todayStr = toLocalISO(today);

        // 2. Fetch Student Profile
        const student = await Student.findOne({
            where: { user_id: userId },
            include: [{ model: Department, attributes: ['name'] }]
        });

        if (!student) {
            return res.status(404).json({ message: 'Student profile not found' });
        }

        // 3. Fetch Task Statistics
        const allAssignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{ model: Task, required: true, include: [{ model: TaskType }] }]
        });

        const stats = {
            total_tasks: allAssignments.length,
            pending_tasks: allAssignments.filter(a => a.status === 'pending').length,
            overdue_tasks: allAssignments.filter(a => {
                const tt = a.Task?.TaskTypes?.[0];
                if (!tt) return false;
                const datePart = toLocalISO(tt.end_date);
                const endTime = new Date(`${datePart}T${tt.end_time}`);
                return (a.status === 'pending' || a.status === 'accepted') &&
                    endTime < localNow &&
                    (!a.proof || a.proof === '');
            }).length
        };

        // 4. Today's Scheduled Tasks
        const todaySchedule = allAssignments.filter(a => {
            const tt = a.Task?.TaskTypes?.[0];
            return tt && toLocalISO(tt.start_date) === todayStr;
        }).map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            description: a.Task.description,
            status: a.status,
            time: a.Task.TaskTypes[0].start_time + ' - ' + a.Task.TaskTypes[0].end_time,
            category: a.Task.category,
            priority: a.Task.priority
        }));

        // 5. Tomorrow's Activity (Pending/Rejected)
        const tomorrowStr = toLocalISO(tomorrow);
        const tomorrowActivity = allAssignments.filter(a => {
            const tt = a.Task?.TaskTypes?.[0];
            return tt && toLocalISO(tt.start_date) === tomorrowStr &&
                (a.status === 'pending' || a.status === 'rejected');
        }).map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            status: a.status,
            time: a.Task.TaskTypes[0].start_time + ' - ' + a.Task.TaskTypes[0].end_time
        }));

        // 6. Pending Proof Submission
        const pendingProof = allAssignments.filter(a => {
            const task = a.Task;
            const tt = task?.TaskTypes?.[0];
            if (!task || !tt || !task.is_document) return false;

            const datePart = toLocalISO(tt.start_date);
            const startTime = new Date(`${datePart}T${tt.start_time}`);
            return (a.status === 'accepted') &&
                startTime <= localNow &&
                (!a.proof || a.proof === '');
        }).map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            deadline: a.Task.TaskTypes[0].end_time,
            status: a.status
        }));

        res.json({
            success: true,
            profile: {
                name: student.name,
                email: student.email,
                reg_no: student.reg_no,
                department: student.Department?.name,
                cgpa: student.c_gpa,
                score: student.score,
                penalty: student.penalty,
                total_score: student.total_score
            },
            stats,
            today_schedule: todaySchedule,
            tomorrow_activity: tomorrowActivity,
            pending_proof: pendingProof
        });

    } catch (error) {
        console.error(`[StudentDashboard] Error: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};

// 1. Get Pending Proof Tasks (Accepted + Document Required + No Proof)
exports.getPendingProofTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');
        const { limit, offset, page } = getPagination(req.query);

        // Setup Local Date logic (IST)
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const tasksInfo = await TaskAssign.findAndCountAll({
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
                include: [{
                    model: TaskType,
                    required: true
                }]
            }],
            limit,
            offset,
            order: [[Task, TaskType, 'start_date', 'ASC'], [Task, TaskType, 'start_time', 'ASC']]
        });

        // Helper for date masking
        const toLocalISO = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Filter for tasks that have already started
        const startedTasks = tasksInfo.rows.filter(a => {
            const tt = a.Task.TaskTypes && a.Task.TaskTypes[0];
            if (!tt) return false;
            const datePart = toLocalISO(tt.start_date);
            const startDateTime = new Date(`${datePart}T${tt.start_time}`);
            return startDateTime <= localNow;
        });

        const formatted = startedTasks.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            description: a.Task.description,
            is_document: a.Task.is_document,
            status: a.status,
            proof_status: 'Not Submitted',
            timing: {
                start_date: a.Task.TaskTypes[0].start_date,
                start_time: a.Task.TaskTypes[0].start_time,
                end_date: a.Task.TaskTypes[0].end_date,
                end_time: a.Task.TaskTypes[0].end_time
            }
        }));

        res.json(getPagingData({ count: startedTasks.length, rows: formatted }, page, limit));
    } catch (error) {
        console.error('Error in getPendingProofTasks:', error);
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

// 2b. Get Tasks Scheduled for Today by User ID (Improved)
exports.getTasksAssignedTodayByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const { Op } = require('sequelize');
        
        const now = new Date();
        const todayStr = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    where: {
                        [Op.and]: [
                            { start_date: { [Op.lte]: `${todayStr} 23:59:59` } },
                            {
                                [Op.or]: [
                                    { end_date: { [Op.gte]: `${todayStr} 00:00:00` } },
                                    { end_date: null }
                                ]
                            }
                        ]
                    }
                }]
            }]
        });

        // Helper for robust IST date string
        const toISTDateStr = (d) => {
            if (!d) return null;
            return new Date(new Date(d).getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];
        };

        const isOccurrence = (targetDateStr, tStart, tEnd, recurrence) => {
            const startStr = toISTDateStr(tStart);
            const endStr = toISTDateStr(tEnd);

            if (targetDateStr < startStr) return false;
            if (endStr && targetDateStr > endStr) return false;

            if (recurrence === 'none' || !recurrence) return targetDateStr === startStr;
            if (recurrence === 'daily') return true;

            const targetDate = new Date(`${targetDateStr}T00:00:00`);
            const startDate = new Date(`${startStr}T00:00:00`);

            if (recurrence === 'weekly') return targetDate.getDay() === startDate.getDay();
            if (recurrence === 'monthly') return targetDate.getDate() === startDate.getDate();
            return false;
        };

        const todayTasks = [];
        assignments.forEach(a => {
            const task = a.Task;
            const taskType = task.TaskTypes[0];
            if (isOccurrence(todayStr, taskType.start_date, taskType.end_date, taskType.recurrence)) {
                todayTasks.push({
                    assignment_id: a.id,
                    task_id: task.task_id,
                    title: task.title,
                    status: a.status,
                    priority: task.priority,
                    category: task.category,
                    timing: {
                        start_time: taskType.start_time,
                        end_time: taskType.end_time
                    }
                });
            }
        });

        res.json({
            user_id: userId,
            date: todayStr,
            count: todayTasks.length,
            tasks: todayTasks
        });
    } catch (error) {
        console.error('Error in getTasksAssignedTodayByUserId:', error);
        res.status(500).json({ message: error.message });
    }
};

// Delete Task Assignment (Soft Delete)
exports.deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const assignment = await TaskAssign.findByPk(id, {
            include: [{ model: Task }]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Only admin or creator of the task can delete the assignment
        if (userRole !== 'admin' && assignment.Task.creator_id !== userId) {
            return res.status(403).json({ message: 'Only an admin or the task creator can delete this assignment' });
        }

        await assignment.destroy(); // Soft delete due to paranoid: true in model
        
        await TaskLog.create({
            task_id: assignment.task_id,
            user_id: userId,
            action: 'delete_assignment',
            details: `Assignment ID ${id} (User ID ${assignment.user_id}) deleted by ${userRole}`
        });

        res.json({ message: 'Task assignment deleted successfully' });

    } catch (error) {
        console.error('Error in deleteAssignment:', error);
        res.status(500).json({ message: error.message });
    }
};

// 3. Get Approved Upcoming Tasks
exports.getApprovedUpcomingTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();
        const { limit, offset, page } = getPagination(req.query);

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

        // Manual pagination
        const paginated = formatted.slice(offset, offset + limit);

        res.json(getPagingData({ count: formatted.length, rows: paginated }, page, limit));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 4. Get Pending Upcoming Tasks (Unapproved & Future Start)
exports.getPendingUpcomingTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();
        const { limit, offset, page } = getPagination(req.query);

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

        // Manual pagination
        const paginated = formatted.slice(offset, offset + limit);

        res.json(getPagingData({ count: formatted.length, rows: paginated }, page, limit));
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
            where: {
                user_id: userId,
                status: { [Op.in]: ['accepted', 'completed'] }
            },
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

        // Filter overlaps and sort
        Object.keys(schedule).forEach(dKey => {
            // Sort by start_time
            schedule[dKey].sort((b, c) => (b.timing.start_time || '').localeCompare(c.timing.start_time || ''));

            // Overlap removal logic: Keep only the first task that starts after the previous task ends
            const filteredTasks = [];
            let lastEndTime = null;

            for (const task of schedule[dKey]) {
                const startTime = task.timing.start_time;
                const endTime = task.timing.end_time;

                if (!lastEndTime || (startTime && startTime >= lastEndTime)) {
                    filteredTasks.push(task);
                    if (endTime) {
                        lastEndTime = endTime;
                    } else if (startTime) {
                        // If no end time, assume a duration of 30 mins or just block the slot
                        const [hours, minutes, seconds] = startTime.split(':').map(Number);
                        const end = new Date();
                        end.setHours(hours, minutes + 30, seconds || 0);
                        lastEndTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}:${String(end.getSeconds()).padStart(2, '0')}`;
                    }
                }
            }
            schedule[dKey] = filteredTasks;
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
                },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskTitle,
                    required: false
                },
                {
                    model: Task,
                    as: 'Children',
                    include: [
                        { model: TaskType },
                        {
                            model: TaskAssign,
                            include: [
                                {
                                    model: User,
                                    attributes: ['user_id', 'role'],
                                    include: [
                                        { model: Student, attributes: ['name', 'email'], required: false },
                                        { model: Faculty, attributes: ['name', 'email'], required: false },
                                        { model: Staff, attributes: ['name', 'email'], required: false },
                                        { model: RoleUser, attributes: ['name', 'email'], required: false }
                                    ]
                                }
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
            task_title_id: task.task_title_id, // NEW
            title: task.title,
            master_title: task.TaskTitle ? {
                id: task.TaskTitle.id,
                title: task.TaskTitle.task_title
            } : null,
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

            // Closure Details
            closure_rules: task.TaskPackageClosures?.map(tpc => tpc.TaskClosure?.name) || [],

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

// 7. Get Unapproved Tasks (Pending + Start Time <= Now)
exports.getUnapprovedTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();
        const { limit, offset, page } = getPagination(req.query);

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    { model: TaskType },
                    { model: Venue, attributes: ['name', 'location'] }
                ]
            }]
        });

        const filtered = assignments.filter(a => {
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

            return startDateTime && startDateTime <= now;
        });

        const formatted = filtered.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            category: a.Task.category,
            priority: a.Task.priority,
            origin_type: a.Task.origin_type,
            start_date: a.Task.TaskTypes[0]?.start_date,
            start_time: a.Task.TaskTypes[0]?.start_time,
            location: a.Task.Venue ? a.Task.Venue.name : null,
            status: a.status
        }));

        // Manual pagination
        const paginated = formatted.slice(offset, offset + limit);

        res.json(getPagingData({ count: formatted.length, rows: paginated }, page, limit));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 8. Get Today's Approved Schedule
exports.getTodaysApprovedSchedule = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const todayDate = new Date();
        const todayStr = getLocalDateString(todayDate);

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'accepted' },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    { model: TaskType, required: true },
                    { model: Venue, attributes: ['name', 'location'] }
                ]
            }]
        });

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

        const todaysTasks = [];
        assignments.forEach(a => {
            a.Task.TaskTypes.forEach(tt => {
                if (isOccurrence(todayStr, tt.start_date, tt.end_date, tt.recurrence)) {
                    todaysTasks.push({
                        assignment_id: a.id,
                        task_id: a.Task.task_id,
                        title: a.Task.title,
                        category: a.Task.category,
                        priority: a.Task.priority,
                        origin_type: a.Task.origin_type,
                        timing: {
                            start_time: tt.start_time,
                            end_time: tt.end_time,
                            recurrence: tt.recurrence
                        },
                        location: a.Task.Venue ? { name: a.Task.Venue.name, location: a.Task.Venue.location } : null,
                        status: a.status
                    });
                }
            });
        });

        // Sort by start time
        todaysTasks.sort((a, b) => (a.timing.start_time || '').localeCompare(b.timing.start_time || ''));

        res.json({
            date: todayStr,
            count: todaysTasks.length,
            tasks: todaysTasks
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Pause a task
exports.pauseTask = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const task = await Task.findByPk(id);
        if (!task || task.is_deleted) return res.status(404).json({ message: 'Task not found' });

        if (!task.is_pause_allowed) {
            return res.status(400).json({ message: 'Pausing is not allowed for this task' });
        }

        if (task.is_paused) return res.status(400).json({ message: 'Task is already paused' });

        await task.update({ is_paused: true });

        await TaskLog.create({
            task_id: id,
            user_id: userId,
            action: 'pause',
            details: `Task paused at ${new Date().toISOString()}`
        });

        res.json({ message: 'Task paused successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Resume a task
exports.resumeTask = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const task = await Task.findByPk(id);
        if (!task || task.is_deleted) return res.status(404).json({ message: 'Task not found' });

        if (!task.is_paused) return res.status(400).json({ message: 'Task is not paused' });

        await task.update({ is_paused: false });

        await TaskLog.create({
            task_id: id,
            user_id: userId,
            action: 'resume',
            details: `Task resumed at ${new Date().toISOString()}`
        });

        res.json({ message: 'Task resumed successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7.5. Get Unified Daily Tasks (Directives + Self-Logs)
exports.getDailyTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const { date } = req.query; // Expect YYYY-MM-DD
        const { Op } = require('sequelize');

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        let targetDate = date ? new Date(date) : new Date();

        // --- NEW: Visibility Rule Refinement ---
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        // Fetch user role to determine the visibility shift time
        const { User } = require('../models');
        const user = await User.findByPk(userId);
        const isStudent = user && user.role && user.role.toLowerCase() === 'student';

        // Visibility Shift Rules:
        // Students: Shift to tomorrow at 7:00 PM (19:00)
        // Others: Shift to tomorrow at 4:30 PM (16:30)
        let shouldShiftToTomorrow = false;

        if (!date) {
            if (isStudent) {
                if (localNow.getHours() >= 19) {
                    shouldShiftToTomorrow = true;
                }
            } else {
                if (localNow.getHours() >= 16 && (localNow.getHours() > 16 || localNow.getMinutes() >= 30)) {
                    shouldShiftToTomorrow = true;
                }
            }
        }

        if (shouldShiftToTomorrow) {
            targetDate.setDate(targetDate.getDate() + 1);

            // If tomorrow is Sunday, skip to Monday
            if (targetDate.getDay() === 0) {
                targetDate.setDate(targetDate.getDate() + 1);
            }
        }

        const dateString = getLocalDateString(targetDate);

        // 1. Fetch Directive Tasks (Assigned to the user)
        // Including pending, accepted, rejected (as requested "return the task that pending for approval or reject")
        const directives = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: { [Op.in]: ['pending', 'accepted', 'rejected'] }
            },
            include: [{
                model: Task,
                where: {
                    origin_type: 'directive',
                    is_deleted: false
                },
                include: [{
                    model: TaskType,
                    where: {
                        [Op.or]: [
                            { start_date: dateString },
                            {
                                [Op.and]: [
                                    { start_date: { [Op.lte]: dateString } },
                                    { end_date: { [Op.gte]: dateString } }
                                ]
                            }
                        ]
                    }
                }]
            }],
            order: [['id', 'DESC']]
        });

        // 2. Fetch Self-Log Tasks (Created by the user)
        const selfLogs = await Task.findAll({
            where: {
                creator_id: userId,
                origin_type: 'self-log',
                is_deleted: false
            },
            include: [{
                model: TaskType,
                where: {
                    [Op.or]: [
                        { start_date: dateString },
                        {
                            [Op.and]: [
                                { start_date: { [Op.lte]: dateString } },
                                { end_date: { [Op.gte]: dateString } }
                            ]
                        }
                    ]
                }
            }],
            order: [['task_id', 'DESC']]
        });

        res.json({
            date: dateString,
            directives: directives.map(d => ({
                task_id: d.Task.task_id,
                title: d.Task.title,
                status: d.status,
                category: d.Task.category,
                priority: d.Task.priority,
                time: d.Task.TaskTypes?.[0] ? {
                    start_time: d.Task.TaskTypes[0].start_time,
                    end_time: d.Task.TaskTypes[0].end_time,
                    recurrence: d.Task.TaskTypes[0].recurrence
                } : null
            })),
            self_logs: selfLogs.map(s => ({
                task_id: s.task_id,
                title: s.title,
                status: 'Active', // Self-logs are usually always active if not deleted
                category: s.category,
                priority: s.priority,
                time: s.TaskTypes?.[0] ? {
                    start_time: s.TaskTypes[0].start_time,
                    end_time: s.TaskTypes[0].end_time,
                    recurrence: s.TaskTypes[0].recurrence
                } : null
            }))
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Pause a task (only allowed when is_pause_allowed = true)
exports.pauseTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;

        const task = await Task.findOne({ where: { task_id: taskId, is_deleted: false } });
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Guard: only tasks that allow pausing can be paused
        if (!task.is_pause_allowed) {
            return res.status(403).json({ message: 'This task does not allow pausing (is_pause_allowed is false)' });
        }

        if (task.is_paused) {
            return res.status(400).json({ message: 'Task is already paused' });
        }

        await task.update({ is_paused: true });

        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'pause',
            details: `Task paused by user ${userId} at ${new Date().toISOString()}`
        });

        res.json({
            message: 'Task paused successfully',
            task_id: task.task_id,
            is_paused: true
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Resume a paused task (only allowed when is_pause_allowed = true)
exports.resumeTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;

        const task = await Task.findOne({ where: { task_id: taskId, is_deleted: false } });
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Guard: only tasks that allow pausing can be resumed
        if (!task.is_pause_allowed) {
            return res.status(403).json({ message: 'This task does not allow pause/resume (is_pause_allowed is false)' });
        }

        if (!task.is_paused) {
            return res.status(400).json({ message: 'Task is not currently paused' });
        }

        await task.update({ is_paused: false });

        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'resume',
            details: `Task resumed by user ${userId} at ${new Date().toISOString()}`
        });

        res.json({
            message: 'Task resumed successfully',
            task_id: task.task_id,
            is_paused: false
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// 7.6. Get Specialized Daily Task Report (Strictly Created by User)
exports.getDailyTaskReport = async (req, res) => {
    try {
        const userId = req.userId;
        let { date } = req.query; // Expect YYYY-MM-DD
        const { Op } = require('sequelize');

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            if (!d) return null;
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // If no date provided, use today's local date
        if (!date) {
            date = getLocalDateString(new Date());
        }

        // Helper: Check if a date matches a task's schedule (including recurrence)
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

        const createdTasks = await Task.findAll({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType, required: true },
                { model: Venue, attributes: ['name', 'location'] },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskAssign,
                    required: false,
                    include: [{ 
                        model: User, 
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }]
                }
            ],
            order: [['task_id', 'DESC']]
        });

        // 2. Fetch Tasks ASSIGNED TO the user (Directive Tasks)
        const assignedTasks = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    { model: TaskType, required: true },
                    { model: Venue, attributes: ['name', 'location'] },
                    {
                        model: TaskPackageClosure,
                        include: [{ model: TaskClosure, attributes: ['name'] }]
                    },
                    {
                        model: TaskAssign,
                        required: false,
                        include: [{ 
                            model: User, 
                            attributes: ['user_id', 'role'],
                            include: [
                                { model: Student, attributes: ['name'] },
                                { model: Faculty, attributes: ['name'] },
                                { model: Staff, attributes: ['name'] },
                                { model: RoleUser, attributes: ['name'] }
                            ]
                        }]
                    }
                ]
            }],
            order: [['id', 'DESC']]
        });

        // Combine and de-duplicate by task_id
        const allTasksMap = new Map();

        createdTasks.forEach(t => allTasksMap.set(t.task_id, t));
        assignedTasks.forEach(a => {
            if (a.Task && !allTasksMap.has(a.task_id)) {
                allTasksMap.set(a.task_id, a.Task);
            }
        });

        const tasks = Array.from(allTasksMap.values());

        const formatTask = (task) => {
            const type = task.TaskTypes?.[0] || {};
            let assignees = [];
            if (task.TaskAssigns) {
                assignees = task.TaskAssigns.map(a => {
                    const u = a.User || {};
                    const profile = u.Student || u.Faculty || u.Staff || u.RoleUser || {};
                    return {
                        assignment_id: a.id,
                        user_id: a.user_id,
                        status: a.status,
                        name: profile.name || 'Unknown',
                        role: u.role
                    };
                });
            }

            const selfAssignment = task.TaskAssigns?.find(a => a.user_id == userId);
            const closureMethods = (task.TaskPackageClosures || []).map(c => c.TaskClosure?.name).filter(Boolean);

            return {
                task_id: task.task_id,
                title: task.title,
                description: task.description,
                category: task.category,
                priority: task.priority,
                origin_type: task.origin_type,
                status: selfAssignment ? selfAssignment.status : (task.status || 'Active'),
                is_mandatory: task.is_mandatory,
                is_document: task.is_document,
                score: task.score,
                penalty_per_hour: task.penalty_per_hour,
                creator_id: task.creator_id,
                assignees: assignees,
                venue: task.Venue ? {
                    name: task.Venue.name,
                    location: task.Venue.location
                } : null,
                closure_methods: closureMethods,
                time: {
                    start_date: type.start_date,
                    end_date: type.end_date,
                    start_time: type.start_time,
                    end_time: type.end_time,
                    recurrence: type.recurrence
                }
            };
        };

        // Filter and Categorize
        const directiveTasks = [];
        const selfLogTasks = [];

        tasks.forEach(task => {
            const type = task.TaskTypes?.[0];
            if (!type) return;

            // If a specific date is requested, filter by it. 
            // If NO date is requested, fetch ALL tasks associated with the user.
            const matchesDate = !req.query.date || isOccurrence(date, type.start_date, type.end_date, type.recurrence);

            if (matchesDate) {
                const formatted = formatTask(task);
                if (task.origin_type === 'self-log') {
                    selfLogTasks.push(formatted);
                } else {
                    directiveTasks.push(formatted);
                }
            }
        });

        res.json({
            report_for_user: userId,
            date: req.query.date || "All",
            total_task: directiveTasks.length + selfLogTasks.length,
            directive_task_count: directiveTasks.length,
            self_log_count: selfLogTasks.length,
            directive_tasks: directiveTasks,
            self_log_tasks: selfLogTasks
        });

    } catch (error) {
        console.error(`[DailyReport] Error: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};

// 7.7. Get My Escalations (where user is either creator or rejected_user)
exports.getMyEscalations = async (req, res) => {
    try {
        const userId = req.userId;
        const { unread } = req.query;
        const { TaskEscalation, Task, User, TaskType } = require('../models');
        const { Op } = require('sequelize');

        const whereCondition = {
            [Op.or]: [
                { creator_id: userId },
                { rejected_user_id: userId }
            ]
        };

        if (unread === 'true') {
            whereCondition.is_read = false;
        }

        const escalations = await TaskEscalation.findAll({
            where: whereCondition,
            include: [
                {
                    model: Task,
                    include: [{ model: TaskType }]
                },
                { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                { model: User, as: 'RejectedUser', attributes: ['user_id', 'role'] }
            ],
            order: [['created_at', 'DESC']]
        });

        res.json({
            count: escalations.length,
            escalations: escalations.map(e => ({
                id: e.id,
                task_id: e.task_id,
                task_title: e.Task?.title,
                reason: e.reason,
                message: e.msg,
                status: e.status,
                is_read: e.is_read,
                created_at: e.created_at,
                involved_users: {
                    to_user: e.Creator?.user_id,
                    from_user: e.RejectedUser?.user_id
                },
                can_resolve: e.creator_id == userId && e.status === 'pending'
            }))
        });
    } catch (error) {
        console.error(`[Escalation] Error: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:id/analysis
// Comprehensive task lifecycle analysis: Logs, transfers, and role-wise stats
// ─────────────────────────────────────────────────────────────────────────────
exports.getTaskAnalysis = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;
        const { TaskLog, TaskAssign, User, Student, Faculty, Staff, RoleUser, TaskType } = require('../models');

        // 1. Fetch Task Info
        const task = await Task.findByPk(taskId, {
            include: [
                { model: TaskType },
                {
                    model: User, as: 'Creator',
                    include: [
                        { model: Student, attributes: ['name'] },
                        { model: Faculty, attributes: ['name'] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                }
            ]
        });

        if (!task) return res.status(404).json({ message: 'Task not found' });

        // 2. Fetch All Assignments
        const assignments = await TaskAssign.findAll({
            where: { task_id: taskId },
            include: [{
                model: User,
                include: [
                    { model: Student, attributes: ['name'] },
                    { model: Faculty, attributes: ['name'] },
                    { model: Staff, attributes: ['name'] },
                    { model: RoleUser, attributes: ['name'] }
                ]
            }]
        });

        // 3. Fetch All Logs
        const logs = await TaskLog.findAll({
            where: { task_id: taskId },
            include: [{
                model: User,
                include: [
                    { model: Student, attributes: ['name'] },
                    { model: Faculty, attributes: ['name'] },
                    { model: Staff, attributes: ['name'] },
                    { model: RoleUser, attributes: ['name'] }
                ]
            }],
            order: [['created_at', 'ASC']]
        });

        // --- Helper for name resolution ---
        const getProfileName = (u) => {
            if (!u) return 'System';
            const p = u.Student || u.Faculty || u.Staff || u.RoleUser;
            return p ? p.name : (u.role === 'admin' ? 'Administrator' : `User #${u.user_id}`);
        };

        // 4. Calculate Stats by Role
        const stats = {
            total_assignments: assignments.length,
            roles: {}
        };

        assignments.forEach(a => {
            const role = a.User?.role || 'unknown';
            if (!stats.roles[role]) {
                stats.roles[role] = { total: 0, pending: 0, accepted: 0, completed: 0, rejected: 0 };
            }
            stats.roles[role].total++;
            if (stats.roles[role][a.status] !== undefined) {
                stats.roles[role][a.status]++;
            }
        });

        // 5. Format Timeline/Logs
        const timeline = logs.map(l => {
            let actionText = l.action;
            let detailItems = [];

            if (l.action === 'reject_and_transfer') {
                actionText = 'transfer';
            }

            const formattedLog = {
                time: l.created_at,
                action: actionText,
                performer: getProfileName(l.User),
                performer_role: l.User?.role,
                details: l.details
            };

            // Attempt to resolve "To Whom" in re-transfers
            if (l.action === 'reject_and_transfer') {
                const targetAssign = assignments.find(a =>
                    a.reason && (a.reason.includes(`Transferred from ${l.user_id}`) || a.reason.includes(`from ${l.user_id}`))
                );
                if (targetAssign) {
                    formattedLog.transferred_to = getProfileName(targetAssign.User);
                    formattedLog.transfer_reason = l.details;
                    formattedLog.summary = `${formattedLog.performer} transferred task to ${formattedLog.transferred_to}`;
                } else {
                    formattedLog.summary = `${formattedLog.performer} rejected and requested transfer`;
                }
            } else if (l.action === 'accept' || l.action === 'accepted') {
                formattedLog.summary = `${formattedLog.performer} accepted the task`;
            } else if (l.action === 'pause') {
                formattedLog.summary = `${formattedLog.performer} paused the task`;
            } else if (l.action === 'resume') {
                formattedLog.summary = `${formattedLog.performer} resumed the task`;
            } else if (l.action === 'submit_proof') {
                formattedLog.summary = `${formattedLog.performer} submitted proof/completed task`;
            } else {
                formattedLog.summary = `${formattedLog.performer} performed ${actionText}`;
            }

            return formattedLog;
        });

        // Add "Task Created" if not in logs
        if (!timeline.find(log => log.action === 'create' || log.action === 'created')) {
            timeline.unshift({
                time: task.created_at,
                action: 'created',
                performer: getProfileName(task.Creator),
                performer_role: task.Creator?.role,
                summary: `Task created by ${getProfileName(task.Creator)}`
            });
        }

        res.json({
            task: {
                id: task.task_id,
                title: task.title,
                category: task.category,
                priority: task.priority,
                is_approved: task.is_approved,
                is_paused: task.is_paused,
                created_at: task.created_at
            },
            statistics: stats,
            timeline: timeline
        });

    } catch (error) {
        console.error("TASK ANALYSIS ERROR:", error);
        res.status(500).json({ message: error.message });
    }
};

// 12. Notify Pending Assignees (Students)
exports.notifyPendingAssignees = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId; // user requesting to notify (creator or admin)

        const task = await Task.findByPk(taskId, {
            include: [{
                model: TaskAssign,
                where: { status: 'pending' },
                required: false,
                include: [{ model: User, attributes: ['user_id', 'role'] }]
            }]
        });

        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Authorization: only creator or admin can trigger this
        const reqUser = await User.findByPk(userId);
        if (task.creator_id !== userId && reqUser.role.toLowerCase() !== 'admin' && task.faculty_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to notify assignees for this task' });
        }

        const pendingAssignments = task.TaskAssigns || [];
        let notifiedCount = 0;

        for (const assign of pendingAssignments) {
            if (assign.User && assign.User.role && assign.User.role.toLowerCase() === 'student') {
                // Send notification
                await Notification.create({
                    user_id: assign.user_id,
                    title: 'Action Required: Accept Task',
                    msg: `You have a pending task "${task.title}". Please accept or reject it.`,
                    type: 'task_reminder'
                });
                notifiedCount++;
            }
        }

        res.json({
            message: `Successfully notified ${notifiedCount} pending student assignee(s).`,
            notified_count: notifiedCount
        });

    } catch (error) {
        console.error('Error in notifyPendingAssignees:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
