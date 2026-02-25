const { User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department, Task, TaskType, TaskAssign } = require('../models');

// ... (existing getAllUsersWithDetails function) ...

// Get System-wide Statistics (Counts)
exports.getSystemStats = async (req, res) => {
    try {
        // 1. Count Students (Only active users)
        const studentCount = await Student.count({
            include: [{ model: User, where: { status: 'active', role: 'student' } }]
        });

        // 2. Count Faculty (Only active users)
        const facultyCount = await Faculty.count({
            include: [{ model: User, where: { status: 'active', role: 'faculty' } }]
        });

        // 3. Count Staff (Only active users)
        const staffCount = await Staff.count({
            include: [{ model: User, where: { status: 'active', role: 'staff' } }]
        });

        // 4. Count Role Users (Only active users)
        const roleUserCount = await RoleUser.count({
            include: [{ model: User, where: { status: 'active', role: 'role-user' } }]
        });

        // 5. Count Active Tasks (Based on task status)
        const activeTaskCount = await Task.count({
            where: { status: 'Active' }
        });

        res.json({
            success: true,
            counts: {
                students: studentCount,
                faculty: facultyCount,
                staff: staffCount,
                role_users: roleUserCount,
                active_tasks: activeTaskCount
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Student Leaderboard/Analytics
exports.getStudentLeaderboard = async (req, res) => {
    try {
        const students = await Student.findAll({
            include: [{ model: Department, attributes: ['name'] }],
            order: [['score', 'DESC']]
        });

        const totalStudents = students.length;
        // Find top score
        const topScore = totalStudents > 0 ? Math.max(...students.map(s => parseFloat(s.score))) : 0;

        const formatted = students.map(s => {
            const score = parseFloat(s.score || 0);
            const penalty = parseFloat(s.penalty || 0);
            return {
                name: s.name,
                reg_no: s.reg_no,
                department: s.Department?.name || 'N/A',
                year: s.year,
                score: score,
                penalty: penalty,
                total_score: score - penalty
            };
        });

        res.json({
            success: true,
            total_students: totalStudents,
            top_score: topScore,
            leaderboard: formatted
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Faculty Leaderboard/Analytics
exports.getFacultyLeaderboard = async (req, res) => {
    try {
        const facultyMembers = await Faculty.findAll({
            include: [{ model: Department, attributes: ['name'] }],
            order: [['score', 'DESC']]
        });

        const totalFaculty = facultyMembers.length;
        // Find top score
        const topScore = totalFaculty > 0 ? Math.max(...facultyMembers.map(f => parseFloat(f.score))) : 0;

        const formatted = facultyMembers.map(f => {
            const score = parseFloat(f.score || 0);
            const penalty = parseFloat(f.penalty || 0);
            return {
                name: f.name,
                reg_no: f.reg_no,
                department: f.Department?.name || 'N/A',
                type: f.type || 'N/A',
                score: score,
                penalty: penalty,
                total_score: score - penalty
            };
        });

        res.json({
            success: true,
            total_faculty: totalFaculty,
            top_score: topScore,
            leaderboard: formatted
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin Dashboard - Get all users with full details and counts
exports.getAllUsersWithDetails = async (req, res) => {
    try {
        // Fetch all active users EXCEPT admin
        const users = await User.findAll({
            where: {
                status: 'active',
                role: { [require('sequelize').Op.ne]: 'admin' }
            },
            include: [
                {
                    model: Student,
                    required: false,
                    include: [
                        { model: Department, attributes: ['name'] },
                        {
                            model: Faculty,
                            attributes: ['reg_no', 'name'],
                            required: false
                        }
                    ]
                },
                {
                    model: Faculty,
                    required: false,
                    include: [
                        { model: Department, attributes: ['name'] }
                    ]
                },
                { model: Staff, required: false },
                { model: RoleUser, required: false },
                {
                    model: RoleAssignment,
                    required: false,
                    include: [
                        { model: Role, attributes: ['user_role'] },
                        { model: Department, attributes: ['name'] }
                    ]
                }
            ]
        });

        // Count active users by role (excluding admin)
        const studentCount = await Student.count({
            include: [{ model: User, where: { status: 'active', role: 'student' } }]
        });

        const facultyCount = await Faculty.count({
            include: [{ model: User, where: { status: 'active', role: 'faculty' } }]
        });

        const staffCount = await Staff.count({
            include: [{ model: User, where: { status: 'active', role: 'staff' } }]
        });

        const roleUserCount = await RoleUser.count({
            include: [{ model: User, where: { status: 'active', role: 'role-user' } }]
        });

        // Format user details
        const userDetails = users.map(user => {
            let details = {
                user_id: user.user_id,
                role: user.role,
                status: user.status,
                created_at: user.created_at
            };

            // Add role-specific details
            if (user.Student) {
                details.student_info = {
                    reg_no: user.Student.reg_no,
                    name: user.Student.name,
                    email: user.Student.email,
                    department_id: user.Student.department_id,
                    department_name: user.Student.Department?.name || null,
                    year: user.Student.year,
                    c_gpa: user.Student.c_gpa,
                    score: user.Student.score,
                    penalty: user.Student.penalty,
                    faculty_reg_no: user.Student.Faculty?.reg_no || null,
                    faculty_name: user.Student.Faculty?.name || null
                };
            }

            if (user.Faculty) {
                details.faculty_info = {
                    reg_no: user.Faculty.reg_no,
                    name: user.Faculty.name,
                    email: user.Faculty.email,
                    department_id: user.Faculty.department_id,
                    department_name: user.Faculty.Department?.name || null,
                    type: user.Faculty.type
                };
            }

            if (user.Staff) {
                details.staff_info = {
                    name: user.Staff.name,
                    email: user.Staff.email,
                    designation: user.Staff.designation
                };
            }

            if (user.RoleUser) {
                details.role_user_info = {
                    name: user.RoleUser.name,
                    email: user.RoleUser.email,
                    score: user.RoleUser.score,
                    penalty: user.RoleUser.penalty
                };
            }

            if (user.RoleAssignments && user.RoleAssignments.length > 0) {
                details.role_assignments = user.RoleAssignments.map(ra => ({
                    role: ra.Role?.user_role,
                    department: ra.Department?.name
                }));
            }

            return details;
        });

        res.json({
            counts: {
                total_active_users: users.length,
                students: studentCount,
                faculty: facultyCount,
                staff: staffCount,
                role_users: roleUserCount
            },
            users: userDetails
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/dashboard/hod
// HOD Dashboard: Department stats, faculty, schedule, and pending approvals
// ─────────────────────────────────────────────────────────────────────────────
exports.getHodDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op, literal } = require('sequelize');

        // 1. Identify HOD and their Department
        const hodAssignment = await RoleAssignment.findOne({
            where: { user_id: userId },
            include: [
                {
                    model: Role,
                    where: { user_role: 'HOD' }
                },
                { model: Department }
            ]
        });

        if (!hodAssignment || !hodAssignment.Department) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: HOD role not found or no department assigned."
            });
        }

        const deptId = hodAssignment.department_id;
        const deptName = hodAssignment.Department.name;

        // Today's date in IST for schedule filtering
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Visibility Rule (Same as Faculty): Show today's tasks always, tomorrow's after 4:30 PM
        const todayDate = new Date(localNow);
        todayDate.setHours(0, 0, 0, 0);
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const dayAfterTomorrow = new Date(tomorrowDate);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        const isEvening = localNow.getHours() > 16 || (localNow.getHours() === 16 && localNow.getMinutes() >= 30);
        const pendingDateLimit = isEvening ? dayAfterTomorrow : tomorrowDate;

        // 2. Department Statistics
        const studentCount = await Student.count({ where: { department_id: deptId } });
        const facultyCount = await Faculty.count({ where: { department_id: deptId } });

        // 3. Department Faculty List
        const faculties = await Faculty.findAll({
            where: { department_id: deptId },
            attributes: ['user_id', 'name', 'email', 'type', 'reg_no'],
            include: [{ model: User, attributes: ['status'] }]
        });

        const facultyUserIds = faculties.map(f => f.user_id);

        // 4. Pending Approvals for this HOD (Follows Today/Tomorrow rule)
        const pendingApprovals = await Task.findAll({
            where: {
                approver_id: userId,
                is_approved: false,
                is_deleted: false
            },
            attributes: ['task_id', 'title', 'category', 'priority', 'created_at', 'creator_id'],
            include: [
                {
                    model: TaskType,
                    required: true,
                    where: {
                        start_date: {
                            [Op.gte]: todayDate,
                            [Op.lt]: pendingDateLimit
                        }
                    },
                    attributes: ['start_date', 'start_time', 'end_time']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Batch fetch names for creators of pending tasks
        const creatorIds = [...new Set(pendingApprovals.map(t => t.creator_id))];
        const creators = await User.findAll({
            where: { user_id: creatorIds },
            include: [
                { model: Student, attributes: ['name'], required: false },
                { model: Faculty, attributes: ['name'], required: false },
                { model: Staff, attributes: ['name'], required: false },
                { model: RoleUser, attributes: ['name'], required: false }
            ]
        });
        const creatorMap = {};
        creators.forEach(c => {
            const p = c.Student || c.Faculty || c.Staff || c.RoleUser;
            creatorMap[c.user_id] = p ? p.name : `User #${c.user_id}`;
        });

        const formattedPending = pendingApprovals.map(t => ({
            task_id: t.task_id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            requested_by: creatorMap[t.creator_id],
            requested_at: t.created_at,
            timing: t.TaskTypes?.[0] ? `${t.TaskTypes[0].start_date} ${t.TaskTypes[0].start_time}` : 'N/A'
        }));

        // 5. Today's Department Schedule
        // Tasks created by department faculty OR assigned to department members today
        const todaysTasks = await Task.findAll({
            where: {
                is_deleted: false,
                [Op.or]: [
                    { creator_id: { [Op.in]: facultyUserIds } },
                    literal(`EXISTS (SELECT 1 FROM task_assign ta WHERE ta.task_id = \`Task\`.\`task_id\` AND ta.user_id IN (SELECT user_id FROM faculties WHERE department_id = ${deptId} UNION SELECT user_id FROM students WHERE department_id = ${deptId}))`)
                ]
            },
            include: [{
                model: TaskType,
                required: true,
                where: {
                    [Op.or]: [
                        literal(`DATE(start_date) = '${dateStr}'`),
                        {
                            [Op.and]: [
                                literal(`DATE(start_date) <= '${dateStr}'`),
                                literal(`DATE(end_date) >= '${dateStr}'`)
                            ]
                        }
                    ]
                }
            }]
        });

        const schedule = todaysTasks.map(t => ({
            task_id: t.task_id,
            title: t.title,
            creator_name: creatorMap[t.creator_id] || "Creator",
            timing: t.TaskTypes?.[0] ? `${t.TaskTypes[0].start_time} - ${t.TaskTypes[0].end_time}` : 'N/A'
        }));

        // 6. Response
        res.json({
            success: true,
            department: {
                id: deptId,
                name: deptName
            },
            stats: {
                total_students: studentCount,
                total_faculty: facultyCount
            },
            pending_approvals_count: formattedPending.length,
            pending_approvals: formattedPending,
            todays_schedule: schedule
        });

    } catch (error) {
        console.error("HOD DASHBOARD ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/dashboard/hod/department-users
// List all students and faculty in the HOD's department with counts
// ─────────────────────────────────────────────────────────────────────────────
exports.getDepartmentUsers = async (req, res) => {
    try {
        const userId = req.userId;

        // 1. Identify HOD and their Department
        const hodAssignment = await RoleAssignment.findOne({
            where: { user_id: userId },
            include: [
                {
                    model: Role,
                    where: { user_role: 'HOD' }
                },
                { model: Department }
            ]
        });

        if (!hodAssignment || !hodAssignment.Department) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: HOD role not found or no department assigned."
            });
        }

        const deptId = hodAssignment.department_id;
        const deptName = hodAssignment.Department.name;

        // 2. Fetch Students
        const students = await Student.findAll({
            where: { department_id: deptId },
            attributes: ['user_id', 'reg_no', 'name', 'email', 'year', 'score', 'penalty', 'c_gpa'],
            include: [{ model: User, attributes: ['status'] }]
        });

        // 3. Fetch Faculty
        const faculties = await Faculty.findAll({
            where: { department_id: deptId },
            attributes: ['user_id', 'reg_no', 'name', 'email', 'type'],
            include: [{ model: User, attributes: ['status'] }]
        });

        res.json({
            success: true,
            department: {
                id: deptId,
                name: deptName
            },
            counts: {
                total_students: students.length,
                total_faculty: faculties.length
            },
            students: students.map(s => ({
                user_id: s.user_id,
                name: s.name,
                reg_no: s.reg_no,
                email: s.email,
                year: s.year,
                c_gpa: s.c_gpa,
                score: s.score,
                penalty: s.penalty,
                status: s.User?.status
            })),
            faculty: faculties.map(f => ({
                user_id: f.user_id,
                name: f.name,
                reg_no: f.reg_no,
                email: f.email,
                type: f.type,
                status: f.User?.status
            }))
        });

    } catch (error) {
        console.error("GET DEPARTMENT USERS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/dashboard/principal
// Principal Dashboard: Institutional stats and high-level task metrics
// ─────────────────────────────────────────────────────────────────────────────
exports.getPrincipalDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const todayDate = new Date(localNow);
        todayDate.setHours(0, 0, 0, 0);
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const dayAfterTomorrow = new Date(tomorrowDate);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        const isEvening = localNow.getHours() > 16 || (localNow.getHours() === 16 && localNow.getMinutes() >= 30);
        const pendingDateLimit = isEvening ? dayAfterTomorrow : tomorrowDate;

        // 1. Verify Principal Role
        const principalAssignment = await RoleAssignment.findOne({
            where: { user_id: userId },
            include: [{
                model: Role,
                where: { user_role: 'PRINCIPAL' }
            }]
        });

        if (!principalAssignment) {
            return res.status(403).json({
                success: false,
                message: "Access Denied: Principal role not found."
            });
        }

        // 2. Institutional Statistics (Global)
        const deptCount = await Department.count();
        const studentCount = await Student.count();
        const facultyCount = await Faculty.count();

        // 3. Global Task Statistics
        const globalApprovedTasks = await Task.count({ where: { is_approved: true, is_deleted: false } });
        const globalPendingTasks = await Task.count({ where: { is_approved: false, is_deleted: false } });

        // 4. Tasks Specifically Awaiting Principal's Approval (Today/Tomorrow rule)
        const pendingForMe = await Task.findAll({
            where: {
                approver_id: userId,
                is_approved: false,
                is_deleted: false
            },
            attributes: ['task_id', 'title', 'category', 'priority', 'created_at', 'creator_id'],
            include: [
                {
                    model: TaskType,
                    required: true,
                    where: {
                        start_date: {
                            [Op.gte]: todayDate,
                            [Op.lt]: pendingDateLimit
                        }
                    },
                    attributes: ['start_date', 'start_time', 'end_time']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Resolve names for specific pending tasks
        const creatorIds = [...new Set(pendingForMe.map(t => t.creator_id))];
        const creators = await User.findAll({
            where: { user_id: creatorIds },
            include: [
                { model: Student, attributes: ['name'], required: false },
                { model: Faculty, attributes: ['name'], required: false },
                { model: Staff, attributes: ['name'], required: false },
                { model: RoleUser, attributes: ['name'], required: false }
            ]
        });
        const creatorMap = {};
        creators.forEach(c => {
            const p = c.Student || c.Faculty || c.Staff || c.RoleUser;
            creatorMap[c.user_id] = p ? p.name : `User #${c.user_id}`;
        });

        const formattedPending = pendingForMe.map(t => ({
            task_id: t.task_id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            requested_by: creatorMap[t.creator_id],
            requested_at: t.created_at,
            timing: t.TaskTypes?.[0] ? `${t.TaskTypes[0].start_date} ${t.TaskTypes[0].start_time}` : 'N/A'
        }));

        res.json({
            success: true,
            role: "Principal",
            institutional_stats: {
                total_departments: deptCount,
                total_students: studentCount,
                total_faculty: facultyCount
            },
            global_task_stats: {
                total_approved_tasks: globalApprovedTasks,
                total_pending_approval: globalPendingTasks
            },
            personal_actions: {
                pending_my_approval_count: formattedPending.length,
                pending_my_approval_list: formattedPending
            }
        });

    } catch (error) {
        console.error("PRINCIPAL DASHBOARD ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/dashboard/student
// Student Dashboard: Profile, Dept, Faculty, Schedule, and Pending
// ─────────────────────────────────────────────────────────────────────────────
exports.getStudentDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op, literal } = require('sequelize');

        // Today's date in IST
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        const todayDate = new Date(localNow);
        todayDate.setHours(0, 0, 0, 0);
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const dayAfterTomorrow = new Date(tomorrowDate);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        const isEvening = localNow.getHours() > 16 || (localNow.getHours() === 16 && localNow.getMinutes() >= 30);
        const pendingDateLimit = isEvening ? dayAfterTomorrow : tomorrowDate;

        // 1. Fetch Student Details with Dept and Faculty
        const student = await Student.findOne({
            where: { user_id: userId },
            include: [
                { model: Department, attributes: ['name'] },
                { model: Faculty, attributes: ['name', 'email', 'reg_no', 'type'] }
            ]
        });

        if (!student) {
            return res.status(404).json({ success: false, message: "Student profile not found." });
        }

        // 2. Fetch Today's Schedule (Only 'accepted' tasks)
        const todaysAssignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'accepted' },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        [Op.or]: [
                            literal(`DATE(start_date) = '${dateStr}'`),
                            {
                                [Op.and]: [
                                    literal(`DATE(start_date) <= '${dateStr}'`),
                                    literal(`DATE(end_date) >= '${dateStr}'`)
                                ]
                            }
                        ]
                    }
                }]
            }]
        });

        const schedule = todaysAssignments.map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            category: a.Task.category,
            priority: a.Task.priority,
            timing: a.Task.TaskTypes?.[0] ? `${a.Task.TaskTypes[0].start_time} - ${a.Task.TaskTypes[0].end_time}` : 'N/A'
        }));

        // 3. Fetch Pending Tasks for Approval (Today/Tomorrow rule)
        const pendingAssignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        start_date: {
                            [Op.gte]: todayDate,
                            [Op.lt]: pendingDateLimit
                        }
                    },
                    attributes: ['start_date', 'start_time']
                }]
            }]
        });

        const pending = pendingAssignments.map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            category: a.Task.category,
            priority: a.Task.priority,
            date: a.Task.TaskTypes?.[0]?.start_date || 'N/A'
        }));

        // 4. Response
        res.json({
            success: true,
            student_details: {
                user_id: student.user_id,
                name: student.name,
                reg_no: student.reg_no,
                email: student.email,
                year: student.year,
                score: student.score,
                penalty: student.penalty,
                c_gpa: student.c_gpa
            },
            department: student.Department ? student.Department.name : 'N/A',
            assigned_faculty: student.Faculty ? {
                name: student.Faculty.name,
                email: student.Faculty.email,
                reg_no: student.Faculty.reg_no,
                designation: student.Faculty.type
            } : null,
            counts: {
                today_schedule_count: schedule.length,
                pending_approval_count: pending.length
            },
            todays_schedule: schedule,
            pending_for_approval: pending
        });

    } catch (error) {
        console.error("STUDENT DASHBOARD ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

