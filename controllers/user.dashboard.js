const { User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department, Task } = require('../models');

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

