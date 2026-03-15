const { Task, TaskAssign, User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, TaskType, Notification } = require('../models');
const XLSX = require('xlsx');
const { checkTaskOverlap } = require('../utils/task-utils');

// Helper: Get user's role details (check if Principal, HOD, etc.)
const getUserRoleDetails = async (userId) => {
    const user = await User.findByPk(userId);
    if (!user) return null;

    if (user.role === 'role-user') {
        const roleAssignments = await RoleAssignment.findAll({
            where: { user_id: userId },
            include: [{ model: Role, attributes: ['user_role'] }]
        });
        return {
            baseRole: user.role,
            specificRoles: roleAssignments.map(ra => ra.Role?.user_role),
            departmentIds: roleAssignments.map(ra => ra.department_id)
        };
    }

    return { baseRole: user.role, specificRoles: [], departmentIds: [] };
};

// Helper: Check if assigner can assign to assignee
const canAssignTo = async (assignerId, assigneeId) => {
    const assignerDetails = await getUserRoleDetails(assignerId);
    const assignee = await User.findByPk(assigneeId);

    if (!assignerDetails || !assignee) {
        throw new Error('Invalid user IDs');
    }

    const assignerRole = assignerDetails.baseRole;
    const assigneeRole = assignee.role;

    // Admin can assign to anyone
    if (assignerRole === 'admin') return true;

    // Principal can assign to HOD, Faculty, Students
    if (assignerDetails.specificRoles.includes('PRINCIPAL')) {
        return ['role-user', 'faculty', 'student'].includes(assigneeRole);
    }

    // HOD can assign to Incharge, Faculty, Students in their department
    if (assignerDetails.specificRoles.includes('HOD')) {
        if (assigneeRole === 'student' || assigneeRole === 'faculty') {
            const assigneeProfile = assigneeRole === 'student'
                ? await Student.findOne({ where: { user_id: assigneeId } })
                : await Faculty.findOne({ where: { user_id: assigneeId } });

            return assigneeProfile && assignerDetails.departmentIds.includes(assigneeProfile.department_id);
        }
        if (assigneeRole === 'role-user') return true; // Can assign to incharges
    }

    // Faculty can assign to Incharge and Students
    if (assignerRole === 'faculty') {
        return ['role-user', 'student', 'faculty', 'staff'].includes(assigneeRole);
    }

    // Incharge / HOD (role-user) can assign to Staff
    if (assignerRole === 'role-user') {
        return assigneeRole === 'staff' || assigneeRole === 'student' || assigneeRole === 'faculty';
    }

    return false;
};

// Assign task to single user
exports.assignTaskToUser = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const { user_id: assigneeId } = req.body;
        const assignerId = req.userId;

        // Check if task exists
        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Validate assignment permission
        const allowed = await canAssignTo(assignerId, assigneeId);
        if (!allowed) {
            return res.status(403).json({ message: 'You do not have permission to assign this task to the user' });
        }

        // Check if already assigned
        const existing = await TaskAssign.findOne({ where: { task_id: taskId, user_id: assigneeId } });
        if (existing) {
            return res.status(400).json({ message: 'Task already assigned to this user' });
        }

        // Get role to check for auto-acceptance
        const assignee = await User.findByPk(assigneeId);
        const isStaff = assignee && assignee.role === 'staff';

        // Create assignment
        await TaskAssign.create({
            task_id: taskId,
            user_id: assigneeId,
            status: isStaff ? 'accepted' : 'pending',
            accepted_at: isStaff ? new Date() : null
        });

        // Notify if non-student
        if (assignee && assignee.role !== 'student') {
            await Notification.create({
                user_id: assigneeId,
                title: 'New Task Assigned',
                msg: `You have been assigned a new task: ${task.title}`,
                type: 'task_created'
            });
        }

        res.json({ message: 'Task assigned successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Assign to all HODs (Principal only)
exports.assignToAllHODs = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const assignerId = req.userId;

        const assignerDetails = await getUserRoleDetails(assignerId);
        if (!assignerDetails.specificRoles.includes('PRINCIPAL') && assignerDetails.baseRole !== 'admin') {
            return res.status(403).json({ message: 'Only Principal or Admin can assign to all HODs' });
        }

        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Find all HODs
        const hodRole = await Role.findOne({ where: { user_role: 'HOD' } });
        if (!hodRole) {
            return res.status(404).json({ message: 'HOD role not found' });
        }

        const hodAssignments = await RoleAssignment.findAll({ where: { role_id: hodRole.role_id } });
        const hodUserIds = hodAssignments.map(ra => ra.user_id);

        // Bulk create assignments
        const assignments = hodUserIds.map(userId => ({
            task_id: taskId,
            user_id: userId,
            status: 'pending'
        }));

        await TaskAssign.bulkCreate(assignments, { ignoreDuplicates: true });

        // Notify all HODs (all are non-students)
        for (const hodId of hodUserIds) {
            await Notification.create({
                user_id: hodId,
                title: 'New Task Assigned',
                msg: `You have been assigned a new task: ${task.title}`,
                type: 'task_created'
            });
        }

        res.json({ message: `Task assigned to ${hodUserIds.length} HODs successfully` });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Assign to all faculty (Principal/HOD)
exports.assignToAllFaculty = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const { department_id } = req.body; // Optional for HOD
        const assignerId = req.userId;

        const assignerDetails = await getUserRoleDetails(assignerId);

        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        let faculties;

        if (assignerDetails.baseRole === 'admin' || assignerDetails.specificRoles.includes('PRINCIPAL')) {
            // Admin/Principal can assign to any department
            faculties = department_id
                ? await Faculty.findAll({ where: { department_id } })
                : await Faculty.findAll();
        } else if (assignerDetails.specificRoles.includes('HOD')) {
            // HOD can only assign to their department
            const hodDeptId = assignerDetails.departmentIds[0];
            faculties = await Faculty.findAll({ where: { department_id: hodDeptId } });
        } else {
            return res.status(403).json({ message: 'You do not have permission to assign to all faculty' });
        }

        const assignments = faculties.map(f => ({
            task_id: taskId,
            user_id: f.user_id,
            status: 'pending'
        }));

        await TaskAssign.bulkCreate(assignments, { ignoreDuplicates: true });

        // Notify all Faculty (all are non-students)
        for (const f of faculties) {
            await Notification.create({
                user_id: f.user_id,
                title: 'New Task Assigned',
                msg: `You have been assigned a new task: ${task.title}`,
                type: 'task_created'
            });
        }

        res.json({ message: `Task assigned to ${faculties.length} faculty members successfully` });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Assign to all students
exports.assignToAllStudents = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const { department_id } = req.body;
        const assignerId = req.userId;

        const assignerDetails = await getUserRoleDetails(assignerId);

        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        let students;

        if (assignerDetails.baseRole === 'admin' || assignerDetails.specificRoles.includes('PRINCIPAL')) {
            students = department_id
                ? await Student.findAll({ where: { department_id } })
                : await Student.findAll();
        } else if (assignerDetails.specificRoles.includes('HOD')) {
            const hodDeptId = assignerDetails.departmentIds[0];
            students = await Student.findAll({ where: { department_id: hodDeptId } });
        } else if (assignerDetails.baseRole === 'faculty') {
            if (!department_id) {
                return res.status(400).json({ message: 'Department ID required for faculty' });
            }
            students = await Student.findAll({ where: { department_id } });
        } else {
            return res.status(403).json({ message: 'You do not have permission to assign to students' });
        }

        const assignments = students.map(s => ({
            task_id: taskId,
            user_id: s.user_id,
            status: 'pending'
        }));

        await TaskAssign.bulkCreate(assignments, { ignoreDuplicates: true });

        res.json({ message: `Task assigned to ${students.length} students successfully` });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Bulk assign by Excel
exports.bulkAssignByExcel = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const assignerId = req.userId;

        if (!req.file) {
            return res.status(400).json({ message: 'Excel file is required' });
        }

        const task = await Task.findByPk(taskId);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Parse Excel
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const assignments = [];
        const errors = [];

        for (const row of data) {
            const { email, user_id } = row;

            let userId = user_id;

            if (!userId && email) {
                // Find user by email
                const student = await Student.findOne({ where: { email } });
                const faculty = await Faculty.findOne({ where: { email } });
                const roleUser = await RoleUser.findOne({ where: { email } });
                const staff = await Staff.findOne({ where: { email } });

                userId = student?.user_id || faculty?.user_id || roleUser?.user_id || staff?.user_id;
            }

            if (!userId) {
                errors.push({ email, error: 'User not found' });
                continue;
            }

            try {
                const allowed = await canAssignTo(assignerId, userId);
                if (!allowed) {
                    errors.push({ email, error: 'Permission denied' });
                    continue;
                }

                const assignee = await User.findByPk(userId);
                const isStaff = assignee && assignee.role === 'staff';

                assignments.push({
                    task_id: taskId,
                    user_id: userId,
                    status: isStaff ? 'accepted' : 'pending',
                    accepted_at: isStaff ? new Date() : null
                });
            } catch (err) {
                errors.push({ email, error: err.message });
            }
        }

        await TaskAssign.bulkCreate(assignments, { ignoreDuplicates: true });

        // Notify non-students
        for (const assign of assignments) {
            const assignee = await User.findByPk(assign.user_id);
            if (assignee && assignee.role !== 'student') {
                await Notification.create({
                    user_id: assign.user_id,
                    title: 'New Task Assigned',
                    msg: `You have been assigned a new task: ${task.title}`,
                    type: 'task_created'
                });
            }
        }

        res.json({
            message: `Task assigned to ${assignments.length} users`,
            success_count: assignments.length,
            error_count: errors.length,
            errors
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Self Assign Task
exports.selfAssignTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const assigneeId = req.userId;

        // Check if task exists
        const task = await Task.findByPk(taskId, {
            include: [{ model: TaskType }]
        });

        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check if already assigned
        const existing = await TaskAssign.findOne({ where: { task_id: taskId, user_id: assigneeId } });
        if (existing) {
            return res.status(400).json({ message: 'You are already assigned to this task' });
        }

        // Check for task overlap
        if (task.TaskTypes && task.TaskTypes.length > 0) {
            const taskType = task.TaskTypes[0];
            const taskDetails = {
                start_date: taskType.start_date,
                end_date: taskType.end_date,
                start_time: taskType.start_time,
                end_time: taskType.end_time,
                task_name: taskType.task_name
            };

            const overlapCheck = await checkTaskOverlap(assigneeId, taskDetails);
            if (overlapCheck.hasConflict) {
                return res.status(412).json({
                    success: false,
                    message: "Cannot self-assign task due to a schedule conflict.",
                    conflictTask: overlapCheck.conflictTask
                });
            }
        }

        // Create assignment and auto-accept
        await TaskAssign.create({
            task_id: taskId,
            user_id: assigneeId,
            status: 'accepted',
            accepted_at: new Date()
        });

        res.json({ message: 'Task self-assigned successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin: Update assignment status directly
exports.adminUpdateStatus = async (req, res) => {
    try {
        const { id: assignmentId } = req.params;
        const { status } = req.body;
        const adminId = req.userId;
        const adminRole = req.userRole;

        if (adminRole !== 'admin') {
            return res.status(403).json({ message: 'Only admins can manually update assignment status' });
        }

        const assignment = await TaskAssign.findByPk(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        await assignment.update({ status });

        // Log the administrative action
        const { TaskLog } = require('../models');
        await TaskLog.create({
            task_id: assignment.task_id,
            user_id: assignment.user_id,
            action: 'admin_status_update',
            details: `Status manually updated to ${status} by Admin ${adminId}`
        });

        res.json({ message: `Assignment status updated to ${status}` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    ...exports,
    canAssignTo
};
