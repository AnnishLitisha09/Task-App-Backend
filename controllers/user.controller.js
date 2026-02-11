const { User, Student, Faculty, Staff, RoleUser, Department, RoleAssignment, Role, AuthAccount, Venue } = require('../models');
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

// Helper: Create auth account with auto-generated password
async function createAuthAccount(user_id, email, name, transaction) {
    // Generate default password: name@123 (e.g., "john@123")
    const defaultPassword = `${name.toLowerCase().replace(/\s+/g, '')}@123`;
    const hash = await bcrypt.hash(defaultPassword, 10);

    return await AuthAccount.create({
        user_id,
        email,
        hashed_password: hash,
        created_at: new Date()
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

        await createAuthAccount(user.user_id, email, name, t);

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

        const existing = await Faculty.findOne({
            where: { [Op.or]: [{ reg_no }, { email }] }
        });
        if (existing) return res.status(400).json({ message: 'Faculty already exists' });

        const user = await createBaseUser('faculty', t);

        await Faculty.create({
            user_id: user.user_id,
            reg_no,
            name,
            email,
            department_id,
            type: type || null,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        // ✅ FIXED
        await createAuthAccount(user.user_id, email, name, t);

        await t.commit();
        res.status(201).json({
            message: 'Faculty created successfully',
            user_id: user.user_id
        });
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

        await createAuthAccount(user.user_id, email, name, t);

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
        const { name, email, roleName, department_id, venue_id } = req.body;

        const existing = await RoleUser.findOne({ where: { email } });
        if (existing) {
            await t.rollback();
            return res.status(400).json({ message: 'Role User already exists' });
        }

        const user = await createBaseUser('role-user', t);

        await RoleUser.create({
            user_id: user.user_id,
            name,
            email,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await createAuthAccount(user.user_id, email, name, t);

        // Unified Creation + Assignment
        if (roleName) {
            const role = await Role.findOne({ where: { user_role: roleName } });
            if (!role) {
                throw new Error(`Role '${roleName}' not found in system`);
            }

            // HOD Logic
            if (roleName === 'HOD') {
                if (!department_id) throw new Error('Department ID is required for HOD assignment');

                // Enforce single HOD: Remove existing HOD for this department
                await RoleAssignment.destroy({
                    where: {
                        role_id: role.role_id,
                        department_id: department_id
                    },
                    transaction: t
                });
            }

            await RoleAssignment.create({
                user_id: user.user_id,
                role_id: role.role_id,
                department_id: department_id || null,
                venue_id: venue_id || null,
                created_at: new Date(),
                updated_at: new Date()
            }, { transaction: t });
        }

        await t.commit();
        res.status(201).json({
            message: 'Role User created and assigned successfully',
            user_id: user.user_id,
            role: roleName || 'No specific role assigned'
        });
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
    const t = await User.sequelize.transaction();
    try {
        const { id } = req.params;

        // Force delete related records to avoid FK constraints
        await RoleAssignment.destroy({ where: { user_id: id }, transaction: t, force: true });
        await AuthAccount.destroy({ where: { user_id: id }, transaction: t, force: true });
        await Student.destroy({ where: { user_id: id }, transaction: t, force: true });
        await Faculty.destroy({ where: { user_id: id }, transaction: t, force: true });
        await Staff.destroy({ where: { user_id: id }, transaction: t, force: true });
        await RoleUser.destroy({ where: { user_id: id }, transaction: t, force: true });

        // Force delete User
        await User.destroy({ where: { user_id: id }, transaction: t, force: true });

        await t.commit();
        res.json({ message: 'User and related data permanently deleted successfully' });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.assignRole = async (req, res) => {
    const t = await RoleAssignment.sequelize.transaction();
    try {
        const { user_id, role_name, department_id, venue_id } = req.body;

        // Lookup Role
        const role = await Role.findOne({ where: { user_role: role_name } });
        if (!role) {
            await t.rollback();
            return res.status(404).json({ message: 'Role not found' });
        }

        if (role_name === 'HOD') {
            if (!department_id) {
                await t.rollback();
                return res.status(400).json({ message: 'Department ID is required for HOD role assignment' });
            }

            // Remove any existing HOD for this department
            await RoleAssignment.destroy({
                where: {
                    role_id: role.role_id,
                    department_id: department_id
                },
                transaction: t
            });
        }

        await RoleAssignment.create({
            user_id,
            role_id: role.role_id,
            department_id: department_id || null,
            venue_id: venue_id || null,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Role assigned successfully' });
    } catch (error) {
        await t.rollback();
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

// Helper: Get full profile details by user ID and role
const getFullProfile = async (id, role) => {
    let userDetails = null;

    switch (role) {
        case 'student':
            userDetails = await Student.findOne({
                where: { user_id: id },
                include: [
                    { model: Department },
                    { model: Faculty, attributes: ['name', 'email'] }
                ]
            });
            break;
        case 'faculty':
            userDetails = await Faculty.findOne({
                where: { user_id: id },
                include: [Department]
            });
            break;
        case 'staff':
            userDetails = await Staff.findOne({ where: { user_id: id } });
            break;
        case 'role-user':
            userDetails = await RoleUser.findOne({
                where: { user_id: id },
                // Include Role Assignments, Roles, Departments, and Venues
                include: [{
                    model: User,
                    include: [{
                        model: RoleAssignment,
                        include: [Role, Department, { model: Venue, as: 'Venue' }]
                    }]
                }]
            });
            // Flatten for better response if needed, but for now include:
            const ra = await RoleAssignment.findAll({
                where: { user_id: id },
                include: [Role, Department, { model: Venue, as: 'Venue' }]
            });
            if (userDetails) {
                userDetails = userDetails.toJSON();
                userDetails.RoleAssignments = ra;
            }
            break;
        case 'admin':
            userDetails = { name: "Admin", email: "admin@example.com" };
            break;
        default:
            break;
    }
    return userDetails;
};

exports.getUserDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userDetails = await getFullProfile(id, user.role);

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

        const userDetails = await getFullProfile(id, user.role);

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

exports.getManagementStaff = async (req, res) => {
    try {
        const facultyStaff = await Faculty.findAll({
            include: [{ model: Department, attributes: ['name'] }]
        });

        const inchargeAssignments = await RoleAssignment.findAll({
            include: [
                { model: Role, attributes: ['user_role'] },
                { model: Venue, as: 'Venue', attributes: ['name'] },
                { model: Department, attributes: ['name'] },
                {
                    model: User,
                    required: true,
                    include: [{ model: RoleUser, required: true }]
                }
            ]
        });

        const formattedFaculty = facultyStaff.map(f => ({
            user_id: f.user_id,
            name: f.name,
            email: f.email,
            type: 'Faculty',
            department: f.Department?.name || 'N/A',
            venue: 'N/A',
            role: f.type || 'Faculty'
        }));

        const inchargeMap = new Map();
        inchargeAssignments.forEach(ra => {
            if (ra.Role?.user_role === 'HOD' && !ra.venue_id) return;

            const userId = ra.user_id;
            const profile = ra.User?.RoleUser;
            if (!profile) return;

            if (!inchargeMap.has(userId)) {
                inchargeMap.set(userId, {
                    user_id: userId,
                    name: profile.name,
                    email: profile.email,
                    type: 'Incharge',
                    department: ra.Department?.name || 'N/A',
                    venue: ra.Venue?.name || 'N/A',
                    role: ra.Role?.user_role || 'Incharge'
                });
            } else {
                const existing = inchargeMap.get(userId);
                if (ra.Venue?.name && !existing.venue.includes(ra.Venue.name)) {
                    existing.venue = existing.venue === 'N/A' ? ra.Venue.name : `${existing.venue}, ${ra.Venue.name}`;
                }
                if (ra.Role?.user_role && !existing.role.includes(ra.Role.user_role)) {
                    existing.role = `${existing.role}, ${ra.Role.user_role}`;
                }
            }
        });

        res.json({
            faculty: formattedFaculty,
            incharges: Array.from(inchargeMap.values()),
            total_management_staff: formattedFaculty.length + inchargeMap.size
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllHODs = async (req, res) => {
    try {
        const hodAssignments = await RoleAssignment.findAll({
            where: { '$Role.user_role$': 'HOD' },
            include: [
                { model: Role, attributes: ['user_role'] },
                { model: Department, attributes: ['name'] },
                {
                    model: User,
                    required: true,
                    include: [{ model: RoleUser, required: true }]
                }
            ]
        });

        const hodMap = new Map();

        hodAssignments.forEach(ra => {
            const userId = ra.user_id;
            const profile = ra.User?.RoleUser;
            if (!profile) return;

            if (!hodMap.has(userId)) {
                hodMap.set(userId, {
                    user_id: userId,
                    name: profile.name,
                    email: profile.email,
                    department: ra.Department?.name || 'N/A',
                    role: ra.Role?.user_role
                });
            } else {
                // If they have multiple assignments, append the department names
                const existing = hodMap.get(userId);
                if (ra.Department?.name && !existing.department.includes(ra.Department.name)) {
                    existing.department = `${existing.department}, ${ra.Department.name}`;
                }
            }
        });

        res.json(Array.from(hodMap.values()));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllIncharges = async (req, res) => {
    try {
        const inchargeAssignments = await RoleAssignment.findAll({
            where: {
                [Op.or]: [
                    { venue_id: { [Op.not]: null } },
                    { '$Role.user_role$': { [Op.not]: 'HOD' } }
                ]
            },
            include: [
                { model: Role, attributes: ['user_role'] },
                { model: Venue, as: 'Venue', attributes: ['name'] },
                { model: Department, attributes: ['name'] },
                {
                    model: User,
                    required: true,
                    include: [{ model: RoleUser, required: true }]
                }
            ]
        });

        const inchargeMap = new Map();

        inchargeAssignments.forEach(ra => {
            if (ra.Role?.user_role === 'HOD' && !ra.venue_id) return;

            const userId = ra.user_id;
            const profile = ra.User?.RoleUser;
            if (!profile) return;

            if (!inchargeMap.has(userId)) {
                inchargeMap.set(userId, {
                    user_id: userId,
                    name: profile.name,
                    email: profile.email,
                    department: ra.Department?.name || 'N/A',
                    venue: ra.Venue?.name || 'N/A',
                    role: ra.Role?.user_role || 'Incharge'
                });
            } else {
                const existing = inchargeMap.get(userId);
                if (ra.Venue?.name && !existing.venue.includes(ra.Venue.name)) {
                    existing.venue = existing.venue === 'N/A' ? ra.Venue.name : `${existing.venue}, ${ra.Venue.name}`;
                }
                if (ra.Role?.user_role && !existing.role.includes(ra.Role.user_role)) {
                    existing.role = `${existing.role}, ${ra.Role.user_role}`;
                }
            }
        });

        res.json(Array.from(inchargeMap.values()));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
