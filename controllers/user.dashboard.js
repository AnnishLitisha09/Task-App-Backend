const { User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department, Task, TaskType, TaskAssign, TaskLog, Venue } = require('../models');
const { isOccurrence, toISTDateStr } = require('../utils/task-utils');
const { Op, literal } = require('sequelize');

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
                role: { [Op.ne]: 'admin' }
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
                        { model: Department, attributes: ['name'] },
                        { model: Venue, attributes: ['name', 'location'] }
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
                    department: ra.Department?.name,
                    venue: ra.Venue?.name
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/users/dashboard/hod
// HOD Dashboard: Department stats, faculty, schedule, and pending approvals
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getHodDashboard = async (req, res) => {
    const profileMap = {};
    const getName = (id) => profileMap[id]?.name || `User #${id}`;
    const getRole = (id) => profileMap[id]?.role || "N/A";
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

        const isEvening = localNow.getHours() >= 19;
        const effectiveTodayStr = isEvening ?
            `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}` :
            dateStr;
        const pendingDateLimit = isEvening ? dayAfterTomorrow : tomorrowDate;

        // 2. Department Statistics
        const studentCount = await Student.count({ where: { department_id: deptId } });
        const facultyCount = await Faculty.count({ where: { department_id: deptId } });

        // 3. Department Faculty and Student List
        const faculties = await Faculty.findAll({
            where: { department_id: deptId },
            attributes: ['user_id', 'name', 'email', 'type', 'reg_no'],
            include: [{ model: User, attributes: ['status'] }]
        });

        const students = await Student.findAll({
            where: { department_id: deptId },
            attributes: ['user_id', 'name']
        });

        const deptUserIds = [
            ...faculties.map(f => f.user_id),
            ...students.map(s => s.user_id)
        ];

        // 4. Tasks Awaiting Approval from this HOD (as Approver)
        const awaitingMyApproval = await Task.findAll({
            where: {
                approver_id: userId,
                is_approved: false,
                is_deleted: false
            },
            attributes: ['task_id', 'title', 'category', 'priority', 'created_at', 'creator_id'],
            include: [
                {
                    model: TaskType,
                    required: false,
                    attributes: ['start_date', 'start_time', 'end_time']
                }
            ],
            order: [['created_at', 'DESC']]
        });
        
        // 4a. Tasks Assigned TO this HOD (as Assignee) that are PENDING
        const assignedPending = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: 'pending'
            },
            include: [
                { 
                    model: Task, 
                    where: { is_deleted: false },
                    include: [{ model: TaskType, required: false }]
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // 4b. Escalations for Tasks created by this creator (ONLY)
        const escalatedAssigns = await TaskAssign.findAll({
            where: { status: { [Op.in]: ['escalated', 'rejected'] } },
            include: [{
                model: Task,
                where: {
                    is_deleted: false,
                    creator_id: userId
                },
                include: [{ model: TaskType }]
            }, {
                model: User,
                attributes: ['user_id', 'role']
            }]
        });


        // Map and group stats and names
        const involvedUserIds = [...new Set([
            ...awaitingMyApproval.map(t => t.creator_id),
            ...assignedPending.map(ap => ap.Task?.creator_id).filter(id => id),
            ...escalatedAssigns.map(ea => ea.user_id)
        ])];

        const usersWithProfiles = await User.findAll({
            where: { user_id: { [Op.in]: involvedUserIds } },
            include: [
                { model: Student, attributes: ['name'], required: false },
                { model: Faculty, attributes: ['name'], required: false },
                { model: Staff, attributes: ['name'], required: false },
                { model: RoleUser, attributes: ['name'], required: false }
            ]
        });

        usersWithProfiles.forEach(u => {
            const p = u.Student || u.Faculty || u.Staff || u.RoleUser;
            let displayRole = u.role.charAt(0).toUpperCase() + u.role.slice(1);
            if (displayRole.toLowerCase() === 'role-user') {
                if (u.Faculty) displayRole = "Faculty";
                else if (u.Staff) displayRole = "Staff";
                else if (u.Student) displayRole = "Student";
                else displayRole = "Incharge";
            }
            profileMap[u.user_id] = {
                name: p ? p.name : `User #${u.user_id}`,
                role: displayRole
            };
        });

        const formattedAwaiting = awaitingMyApproval.map(t => ({
            task_id: t.task_id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            requested_by: getName(t.creator_id),
            requested_at: t.created_at,
            timing: t.TaskTypes?.[0] ? `${new Date(t.TaskTypes[0].start_date).toISOString().split('T')[0]} ${t.TaskTypes[0].start_time}` : 'N/A'
        }));

        const formattedAssignedToMe = assignedPending.map(ap => {
            const t = ap.Task;
            return {
                task_id: t.task_id,
                title: t.title,
                category: t.category,
                priority: t.priority,
                assigned_at: ap.created_at,
                assigned_by: getName(t.creator_id),
                timing: t.TaskTypes?.[0] ? `${new Date(t.TaskTypes[0].start_date).toISOString().split('T')[0]} ${t.TaskTypes[0].start_time}` : 'N/A'
            };
        });

        // 4b. Escalations for Tasks created by this creator (ONLY)
        // Re-fetch with parent_task_id to enable root-task grouping
        const escalatedAssigns2 = await TaskAssign.findAll({
            where: { status: { [Op.in]: ['escalated', 'rejected'] } },
            include: [{
                model: Task,
                where: { is_deleted: false, creator_id: userId },
                attributes: ['task_id', 'title', 'parent_task_id'],
                include: [{ model: TaskType, attributes: ['start_date', 'start_time'] }]
            }, {
                model: User,
                attributes: ['user_id', 'role']
            }]
        });

        // Build a map so we can trace sub-tasks up to root
        // root_task_id = parent_task_id if set, else task_id itself
        const getRootId = (t) => t.parent_task_id || t.task_id;

        // Collect all unique root task IDs
        const rootTaskIds = [...new Set(escalatedAssigns2.map(ea => getRootId(ea.Task)))];

        // Fetch root task titles for those that are parents
        const rootTasks = await Task.findAll({
            where: { task_id: { [Op.in]: rootTaskIds } },
            attributes: ['task_id', 'title'],
            include: [{ model: TaskType, attributes: ['start_date', 'start_time'] }]
        });
        const rootTaskMap = {};
        rootTasks.forEach(rt => {
            rootTaskMap[rt.task_id] = { title: rt.title, timing: rt.TaskTypes?.[0] ? `${rt.TaskTypes[0].start_date} ${rt.TaskTypes[0].start_time}` : 'N/A' };
        });

        // Fetch all assignments for ALL escalated tasks (including subs) to compute stats
        const allEscalatedTaskIds = [...new Set(escalatedAssigns2.map(ea => ea.task_id))];
        const allAssignsForEscalated2 = await TaskAssign.findAll({
            where: { task_id: { [Op.in]: allEscalatedTaskIds.length > 0 ? allEscalatedTaskIds : [0] } },
            attributes: ['task_id', 'status', 'user_id']
        });

        // Group by root task
        const escalationGroups = {};
        escalatedAssigns2.forEach(ea => {
            const t = ea.Task;
            if (!t) return;
            const tt = t.TaskTypes?.[0];
            const rootId = getRootId(t);
            const rootInfo = rootTaskMap[rootId] || { title: t.title, timing: tt ? `${tt.start_date} ${tt.start_time}` : 'N/A' };

            if (!escalationGroups[rootId]) {
                // Gather all assignment records for all tasks under this root
                const relatedTaskIds = escalatedAssigns2
                    .filter(e => getRootId(e.Task) === rootId)
                    .map(e => e.task_id);
                const allAssigns = allAssignsForEscalated2.filter(a => relatedTaskIds.includes(a.task_id));

                escalationGroups[rootId] = {
                    task_id: rootId,
                    title: rootInfo.title,
                    timing: rootInfo.timing,
                    stats: {
                        total_assignees: allAssigns.length,
                        accepted_count: allAssigns.filter(a => a.status === 'accepted').length,
                        pending_count: allAssigns.filter(a => a.status === 'pending').length,
                        rejected_count: allAssigns.filter(a => a.status === 'rejected').length,
                        escalated_count: allAssigns.filter(a => a.status === 'escalated').length
                    },
                    escalated_assignees: []
                };
            }

            // Avoid duplicate assignees (in case same user appears via sub-task and parent)
            const alreadyAdded = escalationGroups[rootId].escalated_assignees.some(
                a => a.user_id === ea.user_id && a.task_context === (t.title)
            );
            if (!alreadyAdded) {
                escalationGroups[rootId].escalated_assignees.push({
                    user_id: ea.user_id,
                    name: getName(ea.user_id),
                    role: getRole(ea.user_id),
                    status: ea.status,
                    task_context: t.title  // which sub-task caused the escalation
                });
            }
        });

        const formattedEscalations = Object.values(escalationGroups).map(group => ({
            ...group,
            summary: `${group.stats.escalated_count} escalated, ${group.stats.rejected_count} rejected out of ${group.stats.total_assignees} total assignees (${group.stats.accepted_count} accepted, ${group.stats.pending_count} pending)`
        }));

        // 5. Today's Department Schedule (Tasks assigned to Me or Dept Members that are ACCEPTED)
        const todaysTasks = await Task.findAll({
            where: {
                is_deleted: false,
                origin_type: { [Op.ne]: 'self-log' }
            },
            include: [{
                model: TaskType,
                required: true,
                where: {
                    [Op.or]: [
                        literal(`DATE(start_date) = '${effectiveTodayStr}'`),
                        {
                            [Op.and]: [
                                literal(`DATE(start_date) <= '${effectiveTodayStr}'`),
                                literal(`DATE(end_date) >= '${effectiveTodayStr}'`)
                            ]
                        }
                    ]
                }
            }, {
                model: TaskAssign,
                required: true,
                where: {
                    user_id: userId,
                    status: { [Op.in]: ['accepted', 'in_progress'] }
                }
            }]
        });

        // Ensure creator names for schedule
        const schedCreatorIds = [...new Set(todaysTasks.map(t => t.creator_id))];
        const missingSchedNames = schedCreatorIds.filter(id => !profileMap[id]);
        if (missingSchedNames.length > 0) {
            const extraRes = await User.findAll({
                where: { user_id: { [Op.in]: missingSchedNames } },
                include: [
                    { model: Student, attributes: ['name'], required: false },
                    { model: Faculty, attributes: ['name'], required: false },
                    { model: Staff, attributes: ['name'], required: false },
                    { model: RoleUser, attributes: ['name'], required: false }
                ]
            });
            extraRes.forEach(u => {
                const p = u.Student || u.Faculty || u.Staff || u.RoleUser;
                let displayRole = u.role.charAt(0).toUpperCase() + u.role.slice(1);
                if (displayRole.toLowerCase() === 'role-user') {
                    if (u.Faculty) displayRole = "Faculty";
                    else if (u.Staff) displayRole = "Staff";
                    else if (u.Student) displayRole = "Student";
                    else displayRole = "Incharge";
                }
                profileMap[u.user_id] = {
                    name: p ? p.name : `User #${u.user_id}`,
                    role: displayRole
                };
            });
        }

        const schedule = todaysTasks.map(t => {
            const tt = t.TaskTypes?.[0];
            const isLongTask = tt?.task_name === 'Date-Only / Long Task' || tt?.task_name === 'Long Task';
            return {
                task_id: t.task_id,
                title: t.title,
                creator_name: getName(t.creator_id),
                timing: isLongTask ? '08:45:00 - 16:30:00' : (tt ? `${tt.start_time} - ${tt.end_time}` : 'N/A')
            };
        });

        // 6. Department Tasks History (Only Tasks for Today, excl. self-log)
        const deptTasks = await Task.findAll({
            where: {
                is_deleted: false,
                creator_id: { [Op.in]: deptUserIds },
                origin_type: { [Op.ne]: 'self-log' }
            },
            include: [{
                model: TaskType,
                required: true,
                where: {
                    [Op.or]: [
                        literal(`DATE(\`TaskTypes\`.\`start_date\`) = '${effectiveTodayStr}'`),
                        {
                            [Op.and]: [
                                literal(`DATE(\`TaskTypes\`.\`start_date\`) <= '${effectiveTodayStr}'`),
                                literal(`DATE(\`TaskTypes\`.\`end_date\`) >= '${effectiveTodayStr}'`)
                            ]
                        }
                    ]
                },
                attributes: ['start_date', 'start_time', 'end_time']
            }],
            order: [['created_at', 'DESC']]
        });

        // Ensure creator names for history
        const historyCreatorIds = [...new Set(deptTasks.map(t => t.creator_id))];
        const missingHistoryNames = historyCreatorIds.filter(id => !profileMap[id]);
        if (missingHistoryNames.length > 0) {
            const extraRes = await User.findAll({
                where: { user_id: { [Op.in]: missingHistoryNames } },
                include: [
                    { model: Student, attributes: ['name'], required: false },
                    { model: Faculty, attributes: ['name'], required: false },
                    { model: Staff, attributes: ['name'], required: false },
                    { model: RoleUser, attributes: ['name'], required: false }
                ]
            });
            extraRes.forEach(c => {
                const p = c.Student || c.Faculty || c.Staff || c.RoleUser;
                let displayRole = c.role.charAt(0).toUpperCase() + c.role.slice(1);
                if (displayRole.toLowerCase() === 'role-user') {
                    if (c.Faculty) displayRole = "Faculty";
                    else if (c.Staff) displayRole = "Staff";
                    else if (c.Student) displayRole = "Student";
                    else displayRole = "Incharge";
                }
                profileMap[c.user_id] = {
                    name: p ? p.name : `User #${c.user_id}`,
                    role: displayRole
                };
            });
        }

        const formattedDeptTasks = deptTasks.map(t => ({
            task_id: t.task_id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            creator_name: getName(t.creator_id),
            created_at: t.created_at,
            timing: t.TaskTypes?.[0] ? `${new Date(t.TaskTypes[0].start_date).toISOString().split('T')[0]} ${t.TaskTypes[0].start_time}` : 'N/A'
        }));

        // 7. Response
        res.json({
            success: true,
            today_date: effectiveTodayStr,
            is_tomorrow_preview: isEvening,
            department: {
                id: deptId,
                name: deptName
            },
            stats: {
                total_students: studentCount,
                total_faculty: facultyCount
            },
            assigned_to_me: formattedAssignedToMe,
            assigned_to_me_count: formattedAssignedToMe.length,
            awaiting_my_approval: formattedAwaiting,
            awaiting_my_approval_count: formattedAwaiting.length,
            escalated_tasks_count: formattedEscalations.length,
            escalated_tasks: formattedEscalations,
            todays_schedule_count: schedule.length,
            todays_schedule: schedule,
            department_tasks_count: formattedDeptTasks.length,
            department_tasks: formattedDeptTasks
        });

    } catch (error) {
        console.error("HOD DASHBOARD ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Dedicated API for HOD to fetch all tasks created in their department
 * GET /api/users/dashboard/department-tasks
 */
exports.getDepartmentalTasks = async (req, res) => {
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

        // 2. Identify all Department Members (Faculty and Students)
        const faculties = await Faculty.findAll({ where: { department_id: deptId }, attributes: ['user_id'] });
        const students = await Student.findAll({ where: { department_id: deptId }, attributes: ['user_id'] });

        const deptUserIds = [
            ...faculties.map(f => f.user_id),
            ...students.map(s => s.user_id)
        ];

        // 3. Time Adjustment for "Today" in IST
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Rule: Show today's tasks always, tomorrow's after 7:00 PM
        const todayDate = new Date(localNow);
        todayDate.setHours(0, 0, 0, 0);
        const tomorrowDate = new Date(todayDate);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);

        const isEvening = localNow.getHours() >= 19;
        const effectiveTodayStr = isEvening ?
            `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}` :
            dateStr;

        
        // 4. Fetch Tasks created by these users for the effective date
        const tasks = await Task.findAll({
            where: {
                is_deleted: false,
                creator_id: { [Op.in]: deptUserIds }
            },
            include: [
                { 
                    model: TaskType, 
                    required: true,
                    where: {
                        [Op.or]: [
                            literal(`DATE(start_date) = '${effectiveTodayStr}'`),
                            {
                                [Op.and]: [
                                    literal(`DATE(start_date) <= '${effectiveTodayStr}'`),
                                    literal(`DATE(end_date) >= '${effectiveTodayStr}'`)
                                ]
                            }
                        ]
                    }
                },
                { model: User, as: 'Creator', attributes: ['user_id', 'role'] }
            ],
            order: [['created_at', 'DESC']]
        });

        // 5. Batch fetch names
        const creatorIds = [...new Set(tasks.map(t => t.creator_id))];
        const creators = await User.findAll({
            where: { user_id: { [Op.in]: creatorIds } },
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

        const formatted = tasks.map(t => ({
            task_id: t.task_id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            creator_name: creatorMap[t.creator_id] || "Creator",
            created_at: t.created_at,
            timing: t.TaskTypes?.[0] ? `${t.TaskTypes[0].start_date} ${t.TaskTypes[0].start_time}` : 'N/A'
        }));

        res.json({
            success: true,
            totalItems: tasks.length,
            items: formatted
        });

    } catch (error) {
        console.error("GET DEPARTMENTAL TASKS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/users/dashboard/hod/department-users
// List all students and faculty in the HOD's department with counts
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            attributes: ['user_id', 'reg_no', 'name', 'email', 'type', 'score', 'penalty', 'total_score'],
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
                score: f.score,
                penalty: f.penalty,
                total_score: f.total_score,
                status: f.User?.status
            }))
        });

    } catch (error) {
        console.error("GET DEPARTMENT USERS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/users/dashboard/principal
// Principal Dashboard: Institutional stats and high-level task metrics
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getPrincipalDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op, literal } = require('sequelize');

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

        const isEvening = localNow.getHours() >= 19;
        const effectiveTodayStr = isEvening ?
            `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}` :
            dateStr;
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

        // 3. Institutional Escalations (All tasks with status 'escalated')
        const allEscalations = await TaskAssign.findAll({
            where: { status: 'escalated' },
            include: [
                { model: Task, include: [{ model: TaskType }] },
                { model: User, attributes: ['user_id', 'role'] }
            ]
        });

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
                    required: false,
                    attributes: ['start_date', 'start_time', 'end_time']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        // Batch fetch profiles
        const involvedUserIds = [...new Set([
            ...pendingForMe.map(t => t.creator_id),
            ...allEscalations.map(e => e.user_id)
        ])];

        const usersWithProfiles = await User.findAll({
            where: { user_id: { [Op.in]: involvedUserIds } },
            include: [
                { model: Student, attributes: ['name'], required: false },
                { model: Faculty, attributes: ['name'], required: false },
                { model: Staff, attributes: ['name'], required: false },
                { model: RoleUser, attributes: ['name'], required: false }
            ]
        });

        const profileNameMap = {};
        usersWithProfiles.forEach(u => {
            const p = u.Student || u.Faculty || u.Staff || u.RoleUser;
            profileNameMap[u.user_id] = p ? p.name : `User #${u.user_id}`;
        });

        const formattedPending = pendingForMe.map(t => ({
            task_id: t.task_id,
            title: t.title,
            category: t.category,
            priority: t.priority,
            requested_by: profileNameMap[t.creator_id],
            requested_at: t.created_at,
            timing: t.TaskTypes?.[0] ? `${new Date(t.TaskTypes[0].start_date).toISOString().split('T')[0]} ${t.TaskTypes[0].start_time}` : 'N/A'
        }));

        const principalEscalationGroups = {};
        allEscalations.forEach(e => {
            const t = e.Task;
            if (!t) return;
            const tt = t.TaskTypes?.[0];
            const groupKey = t.title;

            if (!principalEscalationGroups[groupKey]) {
                principalEscalationGroups[groupKey] = {
                    title: t.title,
                    timing: tt ? `${tt.start_date} ${tt.start_time}` : 'N/A',
                    escalated_assignees: []
                };
            }
            principalEscalationGroups[groupKey].escalated_assignees.push({
                user_id: e.user_id,
                name: profileNameMap[e.user_id],
                role: e.User?.role,
                status: e.status
            });
        });

        const formattedEscalations = Object.values(principalEscalationGroups).map(group => ({
            ...group,
            summary: `${group.escalated_assignees.length} assignees escalated`
        }));

        // 5. Today's Schedule for the Principal
        // todays_schedule: ONLY tasks the user has accepted or is currently doing
        // pending/escalated tasks go under awaiting_my_approval and escalated_tasks sections
        const todaysAssignments = await TaskAssign.findAll({
            where: { user_id: userId, status: { [Op.in]: ['accepted', 'in_progress'] } },
            include: [{
                model: Task,
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        [Op.or]: [
                            literal(`DATE(start_date) = '${effectiveTodayStr}'`),
                            {
                                [Op.and]: [
                                    literal(`DATE(start_date) <= '${effectiveTodayStr}'`),
                                    literal(`DATE(end_date) >= '${effectiveTodayStr}'`)
                                ]
                            }
                        ]
                    }
                }]
            }],
            order: [[literal('`Task->TaskTypes`.`start_time`'), 'ASC']]
        });

        const schedule = todaysAssignments.map(a => {
            const tt = a.Task.TaskTypes?.[0];
            const isLongTask = tt?.task_name === 'Date-Only / Long Task' || tt?.task_name === 'Long Task';
            return {
                task_id: a.Task.task_id,
                title: a.Task.title,
                status: a.status,
                timing: isLongTask ? '08:45:00 - 16:30:00' : (tt ? `${tt.start_time} - ${tt.end_time}` : 'N/A')
            };
        });

        res.json({
            success: true,
            role: "Principal",
            today_date: effectiveTodayStr,
            is_tomorrow_preview: isEvening,
            institutional_stats: {
                total_departments: deptCount,
                total_students: studentCount,
                total_faculty: facultyCount
            },
            personal_actions: {
                pending_my_approval_count: formattedPending.length,
                pending_my_approval_list: formattedPending
            },
            escalations: {
                total_escalated: formattedEscalations.length,
                escalated_list: formattedEscalations
            },
            todays_schedule: schedule
        });

    } catch (error) {
        console.error("PRINCIPAL DASHBOARD ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/users/dashboard/student
// Student Dashboard: Profile, Dept, Faculty, Schedule, and Pending
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
exports.getStudentDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op, literal } = require('sequelize');

        // Cleanup and adjust task statuses dynamically before fetching dashboard
        const { adjustLongTaskStatus, cleanupStudentTasks } = require('../utils/task-utils');
        await cleanupStudentTasks(userId);
        await adjustLongTaskStatus(userId);

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

        const isEvening = localNow.getHours() >= 19;
        const effectiveTodayStr = isEvening ?
            `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}` :
            dateStr;

        // Acknowledge check for TODAY (not effective tomorrow)
        const TaskAcknowledgment = require('../models').TaskAcknowledgment;
        const hasAcknowledgedToday = await TaskAcknowledgment.findOne({
            where: { user_id: userId, task_id: null, acknowledge_date: dateStr }
        });
        const hour = localNow.getHours();
        const minute = localNow.getMinutes();
        const totalMinutes = hour * 60 + minute;
        const needsAcknowledgement = !hasAcknowledgedToday && totalMinutes >= (6 * 60 + 30) && totalMinutes <= (8 * 60 + 45);

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

        // 2. Fetch All Relevant Assignments (Pending/Accepted/In Progress/Completed/Escalated)
        const activeAssignments = await TaskAssign.findAll({
            where: { user_id: userId, status: { [Op.in]: ['pending', 'accepted', 'in_progress', 'escalated', 'completed'] } },
            include: [{
                model: Task,
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
                include: [{
                    model: TaskType,
                    required: true
                }]
            }]
        });

        const schedule = [];
        const overdueTasks = [];

        // Current time for comparison (HH:MM)
        const localTimeStr = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}`;

        const getISTDateStr = (dateVal) => {
            if (!dateVal) return null;
            const d = new Date(dateVal);
            const istOffset = 330 * 60 * 1000;
            const localD = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + istOffset);
            return `${localD.getFullYear()}-${String(localD.getMonth() + 1).padStart(2, '0')}-${String(localD.getDate()).padStart(2, '0')}`;
        };

        activeAssignments.forEach(a => {
            const task = a.Task;
            const taskType = task.TaskTypes?.[0];
            if (!taskType) return;

            const isLongTask = taskType.task_name === 'Date-Only / Long Task' || taskType.task_name === 'Long Task';
            const taskStartStr = toISTDateStr(taskType.start_date);
            const taskEndStr = toISTDateStr(taskType.end_date) || taskStartStr;

            const taskData = {
                assignment_id: a.id,
                assignment_status: a.status,
                accepted_at: a.accepted_at,
                task_id: task.task_id,
                title: task.title,
                description: task.description,
                category: task.category,
                priority: task.priority,
                is_mandatory: task.is_mandatory,
                is_package: task.is_package,
                is_document: task.is_document,
                origin_type: task.origin_type,
                score: task.score,
                penalty_per_hour: task.penalty_per_hour,
                timing: {
                    start_time: isLongTask ? '08:45:00' : taskType.start_time,
                    end_time: isLongTask ? '16:30:00' : taskType.end_time,
                    start_date: taskType.start_date,
                    end_date: taskType.end_date
                },
                task_type: taskType.task_name,
                date: taskEndStr || taskStartStr || 'N/A'
            };


            // Overdue Logic: 
            // 1. End Date is strictly in the past
            // 2. End Date is today AND it's already evening (after 7:00 PM) AND end time has passed
            // AND No proof submitted
            let isOverdue = false;
            const taskEndTime = isLongTask ? '16:30:00' : taskType.end_time;

            if (taskEndStr) {
                if (taskEndStr < dateStr) {
                    isOverdue = true;
                } else if (taskEndStr === dateStr && isEvening) {
                    // Only move to overdue today's tasks AFTER 7:00 PM
                    if (taskEndTime && localTimeStr > taskEndTime) {
                        isOverdue = true;
                    }
                }
            }

            // Task is "Today" if it occurs on the EFFECTIVE Today's date (which is tomorrow after 7 PM)
            const isTodayEffective = isOccurrence(effectiveTodayStr, taskType.start_date, taskType.end_date, taskType.recurrence);

            // Must have NO proof/closure to be truly "Overdue" and NOT COMPLETED
            if (isOverdue && (!a.proof || a.proof === '') && a.status !== 'completed') {
                overdueTasks.push(taskData);
            } else if (isTodayEffective) {
                // If it's the effective today and NOT overdue yet
                // Filter out pending tasks from todays_schedule
                if (a.status !== 'pending' && a.status !== 'completed') {
                    schedule.push(taskData);
                } else if (a.status === 'completed' && isTodayEffective) {
                    // Also include completed tasks in today's schedule for visual confirmation
                    schedule.push(taskData);
                }
            }
        });

        // 3. Fetch Pending Tasks for Approval (Rule: Today unaccepted + Tomorrow's tasks after 7 PM)
        const pendingStartDate = todayDate; // Always include today's unaccepted tasks
        const pendingEndDate = isEvening ? dayAfterTomorrow : tomorrowDate;

        const pendingAssignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{
                model: Task,
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        start_date: {
                            [Op.gte]: pendingStartDate,
                            [Op.lt]: pendingEndDate
                        }
                    },
                    attributes: ['start_date', 'start_time', 'end_time', 'task_name', 'max_acceptances']
                }]
            }]
        });

        // Pre-fetch acceptance counts for Bidding tasks to avoid N+1 queries
        const biddingTaskIds = pendingAssignments
            .filter(a => a.Task?.TaskTypes?.[0]?.task_name === 'Bidding / Nomination Task')
            .map(a => a.Task.task_id);

        const biddingCounts = {};
        if (biddingTaskIds.length > 0) {
            const counts = await TaskAssign.findAll({
                where: {
                    task_id: { [Op.in]: biddingTaskIds },
                    status: { [Op.in]: ['accepted', 'completed', 'in_progress'] }
                },
                attributes: ['task_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']],
                group: ['task_id']
            });
            counts.forEach(c => {
                biddingCounts[c.task_id] = parseInt(c.get('count'));
            });
        }

        const pendingApprovals = [];
        for (const a of pendingAssignments) {
            const taskType = a.Task.TaskTypes?.[0];

            // Filter out Bidding tasks that have reached max acceptances
            if (taskType?.task_name === 'Bidding / Nomination Task' && taskType.max_acceptances) {
                const acceptedCount = biddingCounts[a.Task.task_id] || 0;
                if (acceptedCount >= taskType.max_acceptances) {
                    continue; // Skip, slot is full
                }
            }

            pendingApprovals.push({
                assignment_id: a.id,
                task_id: a.Task.task_id,
                title: a.Task.title,
                description: a.Task.description,
                category: a.Task.category,
                priority: a.Task.priority,
                is_mandatory: a.Task.is_mandatory,
                is_package: a.Task.is_package,
                is_document: a.Task.is_document,
                score: a.Task.score,
                penalty_per_hour: a.Task.penalty_per_hour,
                origin_type: a.Task.origin_type,
                start_date: taskType?.start_date || null,
                start_time: taskType?.start_time || null,
                task_type: taskType?.task_name || null
            });
        }

        // 4. Response
        res.json({
            success: true,
            needs_acknowledgement: needsAcknowledgement,
            today_date: dateStr,
            is_tomorrow_preview: isEvening,
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
                overdue_tasks_count: overdueTasks.length,
                pending_approval_count: pendingApprovals.length
            },
            todays_schedule: schedule,
            overdue_tasks: overdueTasks,
            pending_for_approval: pendingApprovals
        });

    } catch (error) {
        console.error("STUDENT DASHBOARD ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Staff Dashboard: Statistics, Efficiency, Today's Schedule, and Recent Activity
 * GET /api/users/dashboard/staff
 */
exports.getStaffDashboard = async (req, res) => {
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

        const isEvening = localNow.getHours() >= 19;
        const effectiveTodayStr = isEvening ?
            `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}` :
            dateStr;

        // Acknowledge check for TODAY
        const TaskAcknowledgment = require('../models').TaskAcknowledgment;
        const hasAcknowledgedToday = await TaskAcknowledgment.findOne({
            where: { user_id: userId, task_id: null, acknowledge_date: dateStr }
        });
        const hour = localNow.getHours();
        const minute = localNow.getMinutes();
        const totalMinutes = hour * 60 + minute;
        const needsAcknowledgement = !hasAcknowledgedToday && totalMinutes >= (6 * 60 + 30) && totalMinutes <= (8 * 60 + 45);

        // 1. Fetch Staff Details
        const staff = await Staff.findOne({ where: { user_id: userId } });
        if (!staff) {
            return res.status(404).json({ success: false, message: "Staff profile not found." });
        }

        // 2. Task Statistics & Efficiency
        const totalAssignments = await TaskAssign.count({ where: { user_id: userId } });
        const pendingTasks = await TaskAssign.count({ where: { user_id: userId, status: 'pending' } });
        const completedTasks = await TaskAssign.count({ where: { user_id: userId, status: 'completed' } });
        const escalatedTasksCount = await TaskAssign.count({ where: { user_id: userId, status: 'escalated' } });

        const efficiency = totalAssignments > 0 ? ((completedTasks / totalAssignments) * 100).toFixed(2) : "0.00";

        // 3. Managed Employee Count
        const managedEmployeeCount = await Staff.count({
            where: { manager_id: userId }
        });

        // 4. Today's Schedule (using effectiveTodayStr)
        const todaysAssignments = await TaskAssign.findAll({
            where: { user_id: userId, status: { [Op.in]: ['accepted', 'pending', 'in_progress', 'escalated'] } },
            include: [{
                model: Task,
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        [Op.or]: [
                            literal(`DATE(start_date) = '${effectiveTodayStr}'`),
                            {
                                [Op.and]: [
                                    literal(`DATE(start_date) <= '${effectiveTodayStr}'`),
                                    literal(`DATE(end_date) >= '${effectiveTodayStr}'`)
                                ]
                            }
                        ]
                    }
                }]
            }],
            order: [[literal('`Task->TaskTypes`.`start_time`'), 'ASC']]
        });

        const schedule = [];
        const escalatedTasks = [];

        todaysAssignments.forEach(a => {
            const tt = a.Task.TaskTypes?.[0];
            const isLongTask = tt?.task_name === 'Date-Only / Long Task' || tt?.task_name === 'Long Task';
            const taskData = {
                task_id: a.Task.task_id,
                title: a.Task.title,
                status: a.status,
                timing: isLongTask ? '08:45:00 - 16:30:00' : (tt ? `${tt.start_time} - ${tt.end_time}` : 'N/A')
            };

            if (a.status === 'escalated') {
                escalatedTasks.push(taskData);
            } else {
                schedule.push(taskData);
            }
        });

        // 5. Recent Activity (Latest 3 logs)
        const recentLogs = await TaskLog.findAll({
            where: { user_id: userId },
            include: [{ model: Task, attributes: ['title'] }],
            limit: 3,
            order: [['created_at', 'DESC']]
        });

        const activity = recentLogs.map(l => ({
            log_id: l.id,
            task_title: l.Task?.title || "Unknown Task",
            action: l.action,
            details: l.details,
            time: l.created_at
        }));

        res.json({
            success: true,
            needs_acknowledgement: needsAcknowledgement,
            today_date: effectiveTodayStr,
            is_tomorrow_preview: isEvening,
            profile: {
                name: staff.name,
                email: staff.email,
                designation: staff.designation
            },
            stats: {
                total_tasks: totalAssignments,
                pending_tasks: pendingTasks,
                completed_tasks: completedTasks,
                escalated_tasks_count: escalatedTasksCount,
                efficiency: `${efficiency}%`,
                managed_employees_count: managedEmployeeCount
            },
            todays_schedule: schedule,
            escalated_tasks: escalatedTasks,
            recent_activity: activity
        });

    } catch (error) {
        console.error("STAFF DASHBOARD ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Activity History API: Fetch activity for today and yesterday
 * GET /api/users/dashboard/activity-history
 */
exports.getActivityHistory = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        // Setup time range (Today and Yesterday)
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);

        const logs = await TaskLog.findAll({
            where: {
                user_id: userId,
                created_at: { [Op.gte]: yesterdayStart }
            },
            include: [{ model: Task, attributes: ['title'] }],
            order: [['created_at', 'DESC']]
        });

        const history = {
            today: [],
            yesterday: []
        };

        logs.forEach(l => {
            const entry = {
                log_id: l.id,
                task_title: l.Task?.title || "Unknown Task",
                action: l.action,
                details: l.details,
                time: l.created_at
            };

            if (l.created_at >= todayStart) {
                history.today.push(entry);
            } else {
                history.yesterday.push(entry);
            }
        });

        res.json({
            success: true,
            user_id: userId,
            timeframe: "Today & Yesterday",
            counts: {
                today: history.today.length,
                yesterday: history.yesterday.length,
                total: logs.length
            },
            history: history
        });

    } catch (error) {
        console.error("ACTIVITY HISTORY ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


