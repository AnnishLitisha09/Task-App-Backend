const { User, Student, Faculty, Staff, RoleUser, Department, RoleAssignment, Role, AuthAccount, Venue, TaskAssign } = require('../models');
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
        const { reg_no, name, email, department_id, type, roleName, venue_id } = req.body;

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

        await createAuthAccount(user.user_id, email, name, t);

        // Unified Role Assignment (Optional)
        if (roleName) {
            const role = await Role.findOne({ where: { user_role: roleName } });
            if (!role) throw new Error(`Role '${roleName}' not found`);

            await RoleAssignment.create({
                user_id: user.user_id,
                role_id: role.role_id,
                venue_id: venue_id || null,
                department_id: (roleName === 'HOD' ? department_id : null),
                created_at: new Date()
            }, { transaction: t });
        }

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
        const { name, email, designation, roleName, venue_id, manager_id } = req.body;

        const existing = await Staff.findOne({ where: { email } });
        if (existing) return res.status(400).json({ message: 'Staff already exists' });

        const user = await createBaseUser('staff', t);

        await Staff.create({
            user_id: user.user_id,
            manager_id: manager_id || null,
            name,
            email,
            designation,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await createAuthAccount(user.user_id, email, name, t);

        // Unified Role Assignment (Optional)
        if (roleName) {
            const role = await Role.findOne({ where: { user_role: roleName } });
            if (!role) throw new Error(`Role '${roleName}' not found`);

            await RoleAssignment.create({
                user_id: user.user_id,
                role_id: role.role_id,
                venue_id: venue_id || null,
                created_at: new Date()
            }, { transaction: t });
        }

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

            // INCHARGE Logic: Enforce single incharge per venue
            if (roleName === 'INCHARGE' && venue_id) {
                await RoleAssignment.destroy({
                    where: {
                        role_id: role.role_id,
                        venue_id: venue_id
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
                    let managerId = null;
                    if (row.manager_email) {
                        const manager = await Staff.findOne({ where: { email: row.manager_email } });
                        if (manager) managerId = manager.user_id;
                    }

                    const user = await createBaseUser('staff', t);
                    await Staff.create({
                        user_id: user.user_id,
                        manager_id: managerId,
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
            order: [['name', 'ASC']]
        });
        res.json({ total: students.length, students });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getFacultyByDepartment = async (req, res) => {
    try {
        const { deptId } = req.params;
        const faculty = await Faculty.findAll({
            where: { department_id: deptId },
            order: [['name', 'ASC']]
        });
        res.json({
            totalItems: faculty.length,
            items: faculty,
            totalPages: 1,
            currentPage: 1,
            limit: faculty.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getStudentsByFaculty = async (req, res) => {
    try {
        const userId = req.userId;
        const faculty = await Faculty.findOne({ where: { user_id: userId } });
        if (!faculty) return res.status(404).json({ message: 'Faculty profile not found' });

        const students = await Student.findAll({
            where: { faculty_id: faculty.id },
            include: [{ model: Department, attributes: ['name'] }],
            order: [['name', 'ASC']]
        });
        res.json({
            totalItems: students.length,
            items: students,
            totalPages: 1,
            currentPage: 1,
            limit: students.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getFacultyDetailsWithStudents = async (req, res) => {
    try {
        const userId = req.userId; // From verifyToken middleware

        // 1. Find the faculty record with Department
        const faculty = await Faculty.findOne({
            where: { user_id: userId },
            include: [{ model: Department, attributes: ['name'] }]
        });

        if (!faculty) {
            return res.status(404).json({ message: 'Faculty profile not found' });
        }

        // 2. Find all students assigned to this faculty
        const students = await Student.findAll({
            where: { faculty_id: faculty.id },
            attributes: ['user_id', 'reg_no', 'name', 'email', 'year', 'c_gpa', 'score', 'penalty'],
            include: [{ model: Department, attributes: ['name'] }]
        });

        // 3. Construct response
        const response = {
            faculty_info: {
                id: faculty.id,
                name: faculty.name,
                email: faculty.email,
                reg_no: faculty.reg_no,
                department: faculty.Department ? faculty.Department.name : 'N/A',
                type: faculty.type,
                score: faculty.score,
                total_score: faculty.total_score,
                penalty: faculty.penalty
            },
            assigned_students: students,
            student_count: students.length
        };

        res.json(response);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getFacultyDailyStats = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');
        const { TaskAssign, Task, TaskType, Department, Faculty, Student, TaskAcknowledgment } = require('../models');

        // 1. Get faculty profile
        const faculty = await Faculty.findOne({
            where: { user_id: userId },
            include: [{ model: Department, attributes: ['name'] }]
        });

        if (!faculty) {
            return res.status(404).json({ message: 'Faculty profile not found' });
        }

        // 2. Count mentee students
        const menteeCount = await Student.count({
            where: { faculty_id: faculty.id }
        });

        // 3. Setup Date logic (Local time)
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const today = new Date(localNow);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        // Helper to format date
        const toLocalISO = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const todayStr = toLocalISO(today);

        // Visibility Rule: Show tomorrow's tasks after 7:00 PM (19:00)
        const isEvening = localNow.getHours() >= 19;
        const effectiveTodayStr = isEvening ? toLocalISO(tomorrow) : todayStr;

        // Acknowledge check for TODAY
        const hasAcknowledgedToday = await TaskAcknowledgment.findOne({
            where: { user_id: userId, task_id: null, acknowledge_date: todayStr }
        });
        const hour = localNow.getHours();
        const minute = localNow.getMinutes();
        const totalMinutes = hour * 60 + minute;
        const needsAcknowledgement = !hasAcknowledgedToday && totalMinutes >= (6 * 60 + 30) && totalMinutes <= (8 * 60 + 45);

        // 4. Fetch Tasks
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true
                }]
            }],
            order: [
                [Task, TaskType, 'start_date', 'ASC'],
                [Task, TaskType, 'start_time', 'ASC']
            ]
        });

        // 5. Categorize Tasks
        const allTasksToday = [];
        const pendingTasks = [];
        const pendingProofTasks = [];
        const escalatedTasks = [];

        assignments.forEach(a => {
            const task = a.Task;
            const taskType = task.TaskTypes?.[0];
            if (!taskType) return;

            const isLongTask = taskType.task_name === 'Date-Only / Long Task' || taskType.task_name === 'Long Task';
            const taskStartStr = toLocalISO(new Date(taskType.start_date));
            const taskEndStr = toLocalISO(new Date(taskType.end_date || taskType.start_date));

            const taskData = {
                assignment_id: a.id,
                task_id: task.task_id,
                title: task.title,
                status: a.status,
                timing: {
                    start_time: isLongTask ? '08:45:00' : taskType.start_time,
                    end_time: isLongTask ? '16:30:00' : taskType.end_time,
                    start_date: taskType.start_date,
                    end_date: taskType.end_date
                },
                task_type: taskType.task_name,
                assigned_at: a.created_at
            };

            if (a.status === 'escalated') {
                escalatedTasks.push(taskData);
            } else if (a.status === 'pending') {
                // Pending for effective today or future
                if (taskStartStr >= effectiveTodayStr) {
                    pendingTasks.push(taskData);
                }
            } else if (['accepted', 'in_progress', 'completed'].includes(a.status)) {
                // Schedule check for effective today
                if (effectiveTodayStr >= taskStartStr && effectiveTodayStr <= taskEndStr) {
                    allTasksToday.push(taskData);
                }

                // Proof check (based on ACTUAL today)
                if (a.status !== 'completed' && task.is_document && (!a.proof || a.proof === '')) {
                    const taskEndTime = isLongTask ? '16:30:00' : taskType.end_time;
                    const localTimeStr = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}`;
                    if (taskEndStr < todayStr || (taskEndStr === todayStr && localTimeStr > taskEndTime)) {
                        pendingProofTasks.push(taskData);
                    }
                }
            }
        });

        res.json({
            success: true,
            needs_acknowledgement: needsAcknowledgement,
            effective_date: effectiveTodayStr,
            is_tomorrow_preview: isEvening,
            faculty_details: {
                id: faculty.id,
                name: faculty.name,
                department: faculty.Department?.name || 'N/A',
                type: faculty.type,
                mentee_count: menteeCount,
                penalty: faculty.penalty
            },
            counts: {
                today_schedule_count: allTasksToday.length,
                pending_approvals_count: pendingTasks.length,
                pending_proof_count: pendingProofTasks.length,
                escalated_tasks_count: escalatedTasks.length
            },
            todays_schedule: allTasksToday,
            pending_approvals: pendingTasks,
            pending_proof: pendingProofTasks,
            escalated_tasks: escalatedTasks
        });

    } catch (error) {
        console.error('Error in getFacultyDailyStats:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getFacultyTasksByApprovalStatus = async (req, res) => {
    try {
        const userId = req.userId;
        const { approved } = req.query; // 'true' or 'false'
        const { Op } = require('sequelize');

        if (approved === undefined) {
            return res.status(400).json({ message: 'Query parameter "approved" is required (true/false)' });
        }

        const isApproved = approved === 'true';

        // 1. Verify faculty exists
        const faculty = await Faculty.findOne({ where: { user_id: userId } });
        if (!faculty) {
            return res.status(404).json({ message: 'Faculty profile not found' });
        }

        // 2. Get today's date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // 3. Find tasks by approval status for today
        const TaskAssign = require('../models').TaskAssign;
        const Task = require('../models').Task;
        const TaskType = require('../models').TaskType;

        const assignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                created_at: {
                    [Op.gte]: today,
                    [Op.lt]: tomorrow
                }
            },
            include: [{
                model: Task,
                where: {
                    is_deleted: false,
                    is_approved: isApproved
                },
                include: [{ model: TaskType }]
            }]
        });

        // 4. Format response
        const tasks = assignments.map(assignment => ({
            assignment_id: assignment.id,
            task_id: assignment.Task.task_id,
            title: assignment.Task.title,
            description: assignment.Task.description,
            category: assignment.Task.category,
            priority: assignment.Task.priority,
            score: assignment.Task.score,
            penalty_per_hour: assignment.Task.penalty_per_hour,
            is_approved: assignment.Task.is_approved,
            status: assignment.status,
            task_type: assignment.Task.TaskTypes && assignment.Task.TaskTypes[0]
                ? {
                    name: assignment.Task.TaskTypes[0].task_name,
                    start_date: assignment.Task.TaskTypes[0].start_date,
                    end_date: assignment.Task.TaskTypes[0].end_date,
                    start_time: assignment.Task.TaskTypes[0].start_time,
                    end_time: assignment.Task.TaskTypes[0].end_time
                }
                : null,
            assigned_at: assignment.created_at
        }));

        res.json({
            filter: { approved: isApproved, date: today.toISOString().split('T')[0] },
            count: tasks.length,
            tasks
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Helper: Get full profile details by user ID and role
const getFullProfile = async (id, role) => {
    let userDetails = null;

    switch (role?.toLowerCase()) {
        case 'student':
            userDetails = await Student.findOne({
                where: { user_id: id },
                include: [
                    { model: Department },
                    { model: Faculty, attributes: ['id', 'name', 'email', 'reg_no'] },
                    { model: AuthAccount, attributes: ['email'] }
                ]
            });
            break;
        case 'faculty':
            userDetails = await Faculty.findOne({
                where: { user_id: id },
                include: [Department, { model: AuthAccount, attributes: ['email'] }]
            });
            // Fetch assigned students (mentees)
            if (userDetails) {
                const mentees = await Student.findAll({
                    where: { faculty_id: userDetails.id },
                    attributes: ['user_id', 'reg_no', 'name', 'email', 'year', 'c_gpa', 'score', 'total_score', 'penalty'],
                    include: [{ model: Department, attributes: ['name'] }]
                });
                userDetails = userDetails.toJSON();
                userDetails.mentees = mentees;
                userDetails.mentee_count = mentees.length;
            }
            break;
        case 'staff':
            userDetails = await Staff.findOne({
                where: { user_id: id },
                include: [{ model: AuthAccount, attributes: ['email'] }]
            });

            if (userDetails) {
                const userId = userDetails.user_id;

                const counts = await Promise.all([
                    TaskAssign.count({ where: { user_id: userId } }),
                    TaskAssign.count({ where: { user_id: userId, status: { [Op.in]: ['pending', 'accepted'] } } }),
                    TaskAssign.count({ where: { user_id: userId, status: 'completed' } })
                ]);

                userDetails = userDetails.toJSON();
                userDetails.total_tasks = counts[0];
                userDetails.pending_tasks = counts[1];
                userDetails.completed_tasks = counts[2];
            }
            break;
        case 'role-user':
            userDetails = await RoleUser.findOne({
                where: { user_id: id },
                include: [{ model: AuthAccount, attributes: ['email'] }]
            });

            // Fetch generic Role Assignments
            const roleAssignments = await RoleAssignment.findAll({
                where: { user_id: id },
                include: [
                    { model: Role, attributes: ['user_role'] },
                    { model: Department, attributes: ['name'] },
                    { model: Venue, as: 'Venue', attributes: ['name', 'location'] }
                ]
            });

            if (userDetails) {
                userDetails = userDetails.toJSON();

                // Process counting for HOD / Principal
                const enhancedAssignments = await Promise.all(roleAssignments.map(async (ra) => {
                    const roleName = ra.Role?.user_role;
                    let stats = null;

                    if (roleName === 'HOD' && ra.department_id) {
                        const facultyCount = await Faculty.count({ where: { department_id: ra.department_id } });
                        const studentCount = await Student.count({ where: { department_id: ra.department_id } });
                        stats = { faculty_count: facultyCount, student_count: studentCount };
                    } else if (roleName === 'PRINCIPAL') {
                        const totalStudents = await Student.count();
                        const totalFaculty = await Faculty.count();
                        const totalStaff = await Staff.count();
                        const totalHods = await RoleAssignment.count({
                            include: [{ model: Role, where: { user_role: 'HOD' } }]
                        });
                        stats = {
                            total_students: totalStudents,
                            total_faculty: totalFaculty,
                            total_staff: totalStaff,
                            total_hods: totalHods
                        };
                    }

                    return {
                        role: roleName,
                        department: ra.Department?.name || 'N/A',
                        venue: ra.Venue?.name || 'N/A',
                        venue_location: ra.Venue?.location || 'N/A',
                        stats: stats
                    };
                }));

                userDetails.role_assignments = enhancedAssignments;
            }
            break;
        case 'admin':
            const adminUser = await User.findByPk(id, {
                include: [{ model: AuthAccount, attributes: ['email'] }]
            });
            const totalStudents = await Student.count();
            const totalFaculty = await Faculty.count();
            const totalStaff = await Staff.count();
            const totalHods = await RoleAssignment.count({
                include: [{ model: Role, where: { user_role: 'HOD' } }]
            });
            userDetails = {
                user_id: id,
                name: "Administrator",
                email: adminUser?.AuthAccount?.email || "admin@taskapp.com",
                role: 'admin',
                stats: {
                    total_students: totalStudents,
                    total_faculty: totalFaculty,
                    total_staff: totalStaff,
                    total_hods: totalHods
                }
            };
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

// NEW: Comprehensive User Activity API
exports.getUserActivity = async (req, res) => {
    try {
        const { id } = req.params;
        const { Task, TaskType } = require('../models');
        const { Op } = require('sequelize');

        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const profile = await getFullProfile(id, user.role);

        // Date Logic (IST)
        let { date } = req.query; // Optional date from query
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        let targetDate;
        if (date) {
            targetDate = new Date(date);
            // If date is provided as YYYY-MM-DD, it might be interpreted as UTC midnight.
            // We want it to stay consistent with our IST-based "day".
        } else {
            targetDate = localNow;
        }

        const todayStart = new Date(targetDate);
        todayStart.setHours(0, 0, 0, 0);

        const todayEnd = new Date(todayStart);
        todayEnd.setHours(23, 59, 59, 999);

        // Helper: Format YYYY-MM-DD
        const toLocalISO = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const todayStr = toLocalISO(todayStart);

        // 1. Fetch Directives (Assigned to user)
        const directives = await TaskAssign.findAll({
            where: { user_id: id },
            include: [{
                model: Task,
                where: { origin_type: 'directive', is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        [Op.or]: [
                            // Starts today
                            {
                                start_date: {
                                    [Op.gte]: todayStart,
                                    [Op.lte]: todayEnd
                                }
                            },
                            // Or covers today (Multi-day)
                            {
                                [Op.and]: [
                                    { start_date: { [Op.lte]: todayEnd } },
                                    { end_date: { [Op.gte]: todayStart } }
                                ]
                            }
                        ]
                    }
                }]
            }],
            order: [[Task, TaskType, 'start_time', 'ASC']]
        });

        // 2. Fetch Self-Logs (Created by user)
        const selfLogs = await Task.findAll({
            where: { creator_id: id, origin_type: 'self-log', is_deleted: false },
            include: [{
                model: TaskType,
                where: {
                    [Op.or]: [
                        {
                            start_date: {
                                [Op.gte]: todayStart,
                                [Op.lte]: todayEnd
                            }
                        },
                        {
                            [Op.and]: [
                                { start_date: { [Op.lte]: todayEnd } },
                                { end_date: { [Op.gte]: todayStart } }
                            ]
                        }
                    ]
                }
            }],
            order: [[TaskType, 'start_time', 'ASC']]
        });

        res.json({
            user_id: user.user_id,
            role: user.role,
            profile: profile,
            today: {
                date: todayStr,
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
                    status: 'Active',
                    category: s.category,
                    priority: s.priority,
                    time: s.TaskTypes?.[0] ? {
                        start_time: s.TaskTypes[0].start_time,
                        end_time: s.TaskTypes[0].end_time,
                        recurrence: s.TaskTypes[0].recurrence
                    } : null
                }))
            }
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
        const { limit, offset, page } = getPagination(req.query);

        // Fetch everything first because we need careful merging and filtering
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

        const combinedList = [...formattedFaculty, ...Array.from(inchargeMap.values())];

        // Manual pagination
        const totalItems = combinedList.length;
        const paginatedItems = combinedList.slice(offset, offset + limit);

        res.json(getPagingData({ count: totalItems, rows: paginatedItems }, page, limit));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllHODs = async (req, res) => {
    try {
        const { limit, offset, page } = getPagination(req.query);

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
                const existing = hodMap.get(userId);
                if (ra.Department?.name && !existing.department.includes(ra.Department.name)) {
                    existing.department = `${existing.department}, ${ra.Department.name}`;
                }
            }
        });

        const usersList = Array.from(hodMap.values());
        res.json({
            totalItems: usersList.length,
            items: usersList,
            totalPages: 1,
            currentPage: 1,
            limit: usersList.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllIncharges = async (req, res) => {
    try {
        const { limit, offset, page } = getPagination(req.query);

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

        const usersList = Array.from(inchargeMap.values());
        res.json({
            totalItems: usersList.length,
            items: usersList,
            totalPages: 1,
            currentPage: 1,
            limit: usersList.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getUnifiedUsers = async (req, res) => {
    try {
        const { role, department_id } = req.query;

        if (!role) {
            return res.status(400).json({ message: 'Role is required' });
        }

        let responseData = {};

        if (role === 'student') {
            const whereClause = {};
            if (department_id) whereClause.department_id = department_id;

            const users = await Student.findAll({
                where: whereClause,
                attributes: ['user_id', 'name', 'email', 'reg_no', 'score', 'total_score', 'penalty', 'department_id'],
                include: [{ model: Department, attributes: ['name'] }],
                order: [['name', 'ASC']]
            });
            responseData = users;
        } else if (role === 'faculty') {
            const whereClause = {};
            if (department_id) whereClause.department_id = department_id;

            const users = await Faculty.findAll({
                where: whereClause,
                attributes: ['user_id', 'name', 'email', 'reg_no', 'score', 'total_score', 'penalty', 'department_id', 'type'],
                include: [{ model: Department, attributes: ['name'] }],
                order: [['name', 'ASC']]
            });
            responseData = users;
        } else if (role === 'staff') {
            const users = await Staff.findAll({
                attributes: ['user_id', 'name', 'email', 'designation', 'score', 'total_score', 'penalty'],
                order: [['name', 'ASC']]
            });
            responseData = users;
        } else if (role === 'hod') {
            const hodAssignments = await RoleAssignment.findAll({
                where: {
                    '$Role.user_role$': 'HOD',
                    ...(department_id && { department_id })
                },
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

            const usersList = hodAssignments.map(ra => {
                const profile = ra.User?.RoleUser;
                return {
                    user_id: ra.user_id,
                    name: profile ? profile.name : 'Unknown',
                    email: profile ? profile.email : 'Unknown',
                    department: ra.Department?.name || 'N/A',
                    score: profile ? profile.score : 0,
                    total_score: profile ? profile.total_score : 0,
                    penalty: profile ? profile.penalty : 0,
                    role: 'HOD'
                };
            });

            responseData = usersList;
        } else if (role === 'incharge') {
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

            const userMap = new Map();
            inchargeAssignments.forEach(ra => {
                if (ra.Role?.user_role === 'HOD' && !ra.venue_id) return;

                const profile = ra.User?.RoleUser;
                if (!profile) return;

                if (!userMap.has(ra.user_id)) {
                    userMap.set(ra.user_id, {
                        user_id: ra.user_id,
                        name: profile.name,
                        email: profile.email,
                        score: profile.score,
                        total_score: profile.total_score,
                        penalty: profile.penalty,
                        role: ra.Role?.user_role || 'Incharge',
                        department: ra.Department?.name || 'N/A',
                        venue: ra.Venue?.name || 'N/A'
                    });
                }
            });
            responseData = Array.from(userMap.values());
        } else {
            return res.status(400).json({ message: 'Invalid role specified' });
        }

        res.json(responseData);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllUsersByDepartment = async (req, res) => {
    try {
        // 1. Get all departments
        const departments = await Department.findAll({
            attributes: ['department_id', 'name'],
            order: [['name', 'ASC']]
        });

        const result = {
            students: {},
            faculty: {},
            hods: {},
            staff: []
        };

        // 2. For each department, fetch students, faculty, and HODs
        for (const dept of departments) {
            const deptName = dept.name;

            // Get students for this department
            const students = await Student.findAll({
                where: { department_id: dept.department_id },
                attributes: ['user_id', 'reg_no', 'name', 'email', 'year', 'c_gpa', 'score', 'total_score', 'penalty'],
                order: [['name', 'ASC']]
            });
            result.students[deptName] = students;

            // Get faculty for this department
            const faculty = await Faculty.findAll({
                where: { department_id: dept.department_id },
                attributes: ['user_id', 'id', 'reg_no', 'name', 'email', 'type', 'score', 'total_score', 'penalty'],
                order: [['name', 'ASC']]
            });
            result.faculty[deptName] = faculty;

            // Get HODs for this department
            const hodRole = await Role.findOne({ where: { user_role: 'HOD' } });
            if (hodRole) {
                const hodAssignments = await RoleAssignment.findAll({
                    where: {
                        role_id: hodRole.role_id,
                        department_id: dept.department_id
                    },
                    include: [{
                        model: User,
                        required: true,
                        include: [{
                            model: RoleUser,
                            required: true,
                            attributes: ['name', 'email']
                        }]
                    }]
                });

                result.hods[deptName] = hodAssignments.map(assignment => ({
                    user_id: assignment.user_id,
                    name: assignment.User?.RoleUser?.name || 'N/A',
                    email: assignment.User?.RoleUser?.email || 'N/A'
                }));
            } else {
                result.hods[deptName] = [];
            }
        }

        // 3. Get all staff (grouped by designation)
        const staff = await Staff.findAll({
            attributes: ['user_id', 'name', 'email', 'designation'],
            order: [['designation', 'ASC'], ['name', 'ASC']]
        });
        result.staff = staff;

        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
exports.updateStudentFaculty = async (req, res) => {
    try {
        const { id } = req.params; // student user_id
        const { faculty_id } = req.body;

        if (!faculty_id) {
            return res.status(400).json({ message: 'faculty_id is required' });
        }

        const student = await Student.findOne({ where: { user_id: id } });
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        const faculty = await Faculty.findByPk(faculty_id);
        if (!faculty) {
            return res.status(404).json({ message: 'Faculty not found' });
        }

        await student.update({ faculty_id });

        res.json({
            message: 'Student faculty updated successfully',
            student: {
                user_id: student.user_id,
                name: student.name,
                faculty_id: student.faculty_id
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
