const { Leave, User, Student, Faculty, Department } = require('../models');


// --- Student Actions ---

// Apply for Leave
exports.applyLeave = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;

        if (userRole !== 'student') {
            return res.status(403).json({ message: 'Only students can apply for leave' });
        }

        const { leave_type, from_date, to_date, from_time, to_time, reason } = req.body;

        if (!leave_type || !from_date || !to_date) {
            return res.status(400).json({ message: 'Leave type, from date, and to date are required' });
        }

        const leave = await Leave.create({
            user_id: userId,
            leave_type,
            from_date,
            to_date,
            from_time,
            to_time,
            reason,
            status: 'pending'
        });

        res.status(201).json({ message: 'Leave application submitted', leave });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete Leave (only if pending)
exports.deleteLeave = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const leave = await Leave.findOne({ where: { id, user_id: userId } });
        if (!leave) {
            return res.status(404).json({ message: 'Leave application not found' });
        }

        if (leave.status !== 'pending') {
            return res.status(400).json({ message: 'Cannot delete leave that is already processed' });
        }

        await leave.destroy();
        res.json({ message: 'Leave application deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Fetch all leaves applied by the student
exports.getStudentLeaves = async (req, res) => {
    try {
        const userId = req.userId;
        const leaves = await Leave.findAll({
            where: { user_id: userId },
            order: [['created_at', 'DESC']]
        });
        res.json({ total: leaves.length, leaves });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- Faculty Actions ---

// Fetch leave approvals for a specific faculty
exports.getFacultyPendingApprovals = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;
        if (userRole !== 'faculty') return res.status(403).json({ message: 'Access denied' });

        const facultyProfile = await Faculty.findOne({ where: { user_id: userId } });
        if (!facultyProfile) return res.status(404).json({ message: 'Faculty profile not found' });

        const assignedStudents = await Student.findAll({ where: { faculty_id: facultyProfile.id }, attributes: ['user_id'] });
        const studentUserIds = assignedStudents.map(s => s.user_id);

        const leaves = await Leave.findAll({
            where: { user_id: studentUserIds, status: 'pending' },
            include: [{
                model: User,
                attributes: ['user_id', 'role'],
                include: [{ model: Student, attributes: ['name', 'reg_no', 'department_id'], include: [{ model: Department, attributes: ['name'] }] }]
            }],
            order: [['created_at', 'DESC']]
        });

        res.json({ total: leaves.length, leaves });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Fetch all leave applications from students assigned to this faculty (regardless of status)
exports.getFacultyStudentLeaves = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;
        if (userRole !== 'faculty') return res.status(403).json({ message: 'Access denied' });

        const facultyProfile = await Faculty.findOne({ where: { user_id: userId } });
        if (!facultyProfile) return res.status(404).json({ message: 'Faculty profile not found' });

        const assignedStudents = await Student.findAll({ where: { faculty_id: facultyProfile.id }, attributes: ['user_id'] });
        const studentUserIds = assignedStudents.map(s => s.user_id);

        const leaves = await Leave.findAll({
            where: { user_id: studentUserIds },
            include: [{
                model: User,
                attributes: ['user_id', 'role'],
                include: [{ model: Student, attributes: ['name', 'reg_no', 'department_id'], include: [{ model: Department, attributes: ['name'] }] }]
            }],
            order: [['created_at', 'DESC']]
        });

        res.json({ total: leaves.length, leaves });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Approve or Reject Leave
exports.approveOrRejectLeave = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'approved' or 'rejected'
        const userId = req.userId;
        const userRole = req.userRole;

        if (userRole !== 'faculty') {
            return res.status(403).json({ message: 'Only faculty can approve/reject leaves' });
        }

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const leave = await Leave.findByPk(id, {
            include: [{ model: User, include: [{ model: Student }] }]
        });

        if (!leave) {
            return res.status(404).json({ message: 'Leave application not found' });
        }

        // Verify that this student is assigned to this faculty
        const facultyProfile = await Faculty.findOne({ where: { user_id: userId } });
        if (!facultyProfile || leave.User.Student.faculty_id !== facultyProfile.id) {
            return res.status(403).json({ message: 'You are not authorized to process this leave' });
        }

        await leave.update({ status });
        res.json({ message: `Leave ${status} successfully`, leave });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
