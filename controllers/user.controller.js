const { User, Student, Faculty, Staff, RoleUser, Department, RoleAssignment, Role, AuthAccount } = require('../models');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');

// Helper to create base user
const createBaseUser = async (role, transaction) => {
    return await User.create({
        role,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date()
    }, { transaction });
};

// Helper to create AuthAccount
const createAuthAccount = async (user_id, email, transaction) => {
    // Generate a default password (e.g., "password123") or random
    const hashedPassword = await bcrypt.hash("password123", 10);
    return await AuthAccount.create({
        user_id,
        email,
        hashed_password: hashedPassword
    }, { transaction });
};

// Single User Creation
exports.createStudent = async (req, res) => {
    const t = await User.sequelize.transaction();
    try {
        const { reg_no, name, email, department_id, year, c_gpa, faculty_id, score, penalty } = req.body;

        // Check if student exists
        const existing = await Student.findOne({ where: { [Op.or]: [{ reg_no }, { email }] } });
        if (existing) return res.status(400).json({ message: 'Student already exists' });

        const user = await createBaseUser('student', t);

        await Student.create({
            user_id: user.user_id,
            reg_no,
            name,
            email,
            department_id,
            year,
            // section removed
            c_gpa: c_gpa || 0.0,
            faculty_id: faculty_id || null,
            score: score || 0,
            penalty: penalty || 0,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await createAuthAccount(user.user_id, email, t);

        await t.commit();
        res.status(201).json({ message: 'Student created successfully', user_id: user.user_id });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.createFaculty = async (req, res) => {
    const t = await User.sequelize.transaction();
    try {
        const { reg_no, name, email, department_id, type } = req.body;

        const existing = await Faculty.findOne({ where: { [Op.or]: [{ reg_no }, { email }] } });
        if (existing) return res.status(400).json({ message: 'Faculty already exists' });

        const user = await createBaseUser('faculty', t);

        await Faculty.create({
            user_id: user.user_id,
            reg_no,
            name,
            email,
            department_id,
            type: type || null, // Add type
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await createAuthAccount(user.user_id, email, t);

        await t.commit();
        res.status(201).json({ message: 'Faculty created successfully', user_id: user.user_id });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.createStaff = async (req, res) => {
    const t = await User.sequelize.transaction();
    try {
        const { name, email, designation } = req.body;

        const existing = await Staff.findOne({ where: { email } });
        if (existing) return res.status(400).json({ message: 'Staff already exists' });

        const user = await createBaseUser('staff', t);

        await Staff.create({
            user_id: user.user_id,
            name,
            email,
            designation,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await createAuthAccount(user.user_id, email, t);

        await t.commit();
        res.status(201).json({ message: 'Staff created successfully', user_id: user.user_id });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.createRoleUser = async (req, res) => {
    const t = await User.sequelize.transaction();
    try {
        const { name, email, roleName, department_id } = req.body; // e.g. roleName = 'HOD'

        const existing = await RoleUser.findOne({ where: { email } });
        if (existing) return res.status(400).json({ message: 'Role User already exists' });

        const user = await createBaseUser('role-user', t);

        const roleUser = await RoleUser.create({
            user_id: user.user_id,
            name,
            email,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await createAuthAccount(user.user_id, email, t);

        // Assign Role logic if passed immediately
        if (roleName) {
            // Find Role ID from Roles table
            const role = await Role.findOne({ where: { user_role: roleName } });
            if (role) {
                if (!department_id) throw new Error('Department ID required for role assignment');

                await RoleAssignment.create({
                    user_id: user.user_id,
                    role_id: role.role_id,
                    department_id: department_id,
                    created_at: new Date(),
                    updated_at: new Date()
                }, { transaction: t });
            }
        }

        await t.commit();
        res.status(201).json({ message: 'Role User created successfully', user_id: user.user_id });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Bulk Create from Excel
exports.bulkCreateUsers = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const t = await User.sequelize.transaction();

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        const { type } = req.body; // 'student', 'faculty', 'staff'

        if (!rows.length) return res.status(400).json({ message: 'Empty sheet' });

        const results = [];

        for (const row of rows) {
            try {
                // Determine logic based on type
                if (type === 'student') {
                    // Check faculty
                    let facultyId = null;
                    if (row.faculty_email) {
                        const faculty = await Faculty.findOne({ where: { email: row.faculty_email } });
                        if (faculty) facultyId = faculty.id;
                    }
                    else if (row.faculty_reg_no) {
                        const faculty = await Faculty.findOne({ where: { reg_no: row.faculty_reg_no } });
                        if (faculty) facultyId = faculty.id;
                    }

                    // Check Dept
                    let deptId = row.department_id;
                    if (!deptId && row.department_name) {
                        const dept = await Department.findOne({ where: { name: row.department_name } });
                        if (dept) deptId = dept.department_id;
                    }

                    if (!deptId) throw new Error(`Department not found for student ${row.name}`);

                    const user = await createBaseUser('student', t);
                    await Student.create({
                        user_id: user.user_id,
                        reg_no: row.reg_no,
                        name: row.name,
                        email: row.email,
                        department_id: deptId,
                        year: row.year,
                        // section removed
                        c_gpa: row.c_gpa || 0.0,
                        faculty_id: facultyId || null,
                        score: row.score || 0,
                        penalty: row.penalty || 0,
                        created_at: new Date(),
                        updated_at: new Date()
                    }, { transaction: t });
                    await createAuthAccount(user.user_id, row.email, t);
                    results.push({ email: row.email, status: 'created' });

                } else if (type === 'faculty') {
                    let deptId = row.department_id;
                    if (!deptId && row.department_name) {
                        const dept = await Department.findOne({ where: { name: row.department_name } });
                        if (dept) deptId = dept.department_id;
                    }
                    if (!deptId) throw new Error(`Department not found for faculty ${row.name}`);

                    const user = await createBaseUser('faculty', t);
                    await Faculty.create({
                        user_id: user.user_id,
                        reg_no: row.reg_no,
                        name: row.name,
                        email: row.email,
                        department_id: deptId,
                        type: row.type || null, // Add type
                        created_at: new Date(),
                        updated_at: new Date()
                    }, { transaction: t });
                    await createAuthAccount(user.user_id, row.email, t);
                    results.push({ email: row.email, status: 'created' });

                } else if (type === 'staff') {
                    const user = await createBaseUser('staff', t);
                    await Staff.create({
                        user_id: user.user_id,
                        name: row.name,
                        email: row.email,
                        designation: row.designation,
                        created_at: new Date(),
                        updated_at: new Date()
                    }, { transaction: t });
                    await createAuthAccount(user.user_id, row.email, t);
                    results.push({ email: row.email, status: 'created' });
                }
            } catch (err) {
                results.push({ email: row.email, status: 'failed', reason: err.message });
                throw err;
            }
        }

        await t.commit();
        res.json({ message: 'Bulk creation successful', results });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Bulk creation failed', error: error.message });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        await User.destroy({ where: { user_id: id } });
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.assignRole = async (req, res) => {
    try {
        const { user_id, role_name, department_id, venue_id } = req.body;

        // Lookup Role ID
        const role = await Role.findOne({ where: { user_role: role_name } });
        if (!role) return res.status(404).json({ message: 'Role not found' });

        if (!department_id) return res.status(400).json({ message: 'Department ID is required for role assignment' });

        await RoleAssignment.create({
            user_id,
            role_id: role.role_id,
            department_id: department_id,
            venue_id: venue_id || null,
            created_at: new Date(),
            updated_at: new Date()
        });

        res.json({ message: 'Role assigned successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getStudentsByDepartment = async (req, res) => {
    try {
        const { deptId } = req.params;
        const students = await Student.findAll({
            where: { department_id: deptId },
            // include: [{ model: User, attributes: ['status'] }] // Optional
        });
        res.json(students);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getFacultyByDepartment = async (req, res) => {
    try {
        const { deptId } = req.params;
        const faculty = await Faculty.findAll({
            where: { department_id: deptId }
        });
        res.json(faculty);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getUserDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let userDetails = null;

        switch (user.role) {
            case 'student':
                userDetails = await Student.findOne({ where: { user_id: id }, include: [Department] });
                break;
            case 'faculty':
                userDetails = await Faculty.findOne({ where: { user_id: id }, include: [Department] });
                break;
            case 'staff':
                userDetails = await Staff.findOne({ where: { user_id: id } });
                break;
            case 'role-user':
                userDetails = await RoleUser.findOne({ where: { user_id: id } });
                break;
            case 'admin':
                userDetails = { name: "Admin", email: "admin@example.com" };
                break;
            default:
                break;
        }

        if (!userDetails && user.role !== 'admin') {
            return res.status(404).json({ message: 'Profile not found for this user' });
        }

        res.json({
            user_id: user.user_id,
            role: user.role,
            status: user.status,
            profile: userDetails
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const id = req.userId; // Set by verifyToken middleware
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let userDetails = null;

        switch (user.role) {
            case 'student':
                userDetails = await Student.findOne({ where: { user_id: id }, include: [Department] });
                break;
            case 'faculty':
                userDetails = await Faculty.findOne({ where: { user_id: id }, include: [Department] });
                break;
            case 'staff':
                userDetails = await Staff.findOne({ where: { user_id: id } });
                break;
            case 'role-user':
                userDetails = await RoleUser.findOne({ where: { user_id: id } });
                break;
            case 'admin':
                userDetails = { name: "Admin", email: "admin@example.com" };
                break;
            default:
                break;
        }

        if (!userDetails && user.role !== 'admin') {
            return res.status(404).json({ message: 'Profile not found for this user' });
        }

        res.json({
            user_id: user.user_id,
            role: user.role,
            status: user.status,
            profile: userDetails
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
