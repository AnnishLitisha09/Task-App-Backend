const { Task, TaskAssign, TaskAcknowledgment, User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role } = require('../models');
const { Op } = require('sequelize');

// Acknowledge today's tasks
exports.acknowledgeTodaysTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // Get all tasks assigned to user for today (you'll need to add date filtering based on task type)
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{ model: Task }]
        });

        const acknowledged = [];

        for (const assignment of assignments) {
            // Create or update acknowledgment
            const [ack, created] = await TaskAcknowledgment.findOrCreate({
                where: {
                    task_id: assignment.task_id,
                    user_id: userId,
                    acknowledge_date: today
                },
                defaults: {
                    acknowledged_at: new Date()
                }
            });

            if (!created && !ack.acknowledged_at) {
                await ack.update({ acknowledged_at: new Date() });
            }

            acknowledged.push({
                task_id: assignment.task_id,
                task_title: assignment.Task.title,
                acknowledged_at: ack.acknowledged_at
            });
        }

        res.json({
            message: 'Tasks acknowledged successfully',
            count: acknowledged.length,
            tasks: acknowledged
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get today's unacknowledged tasks
exports.getTodaysUnacknowledgedTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const today = new Date().toISOString().split('T')[0];

        // Get all pending task assignments
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{ model: Task }]
        });

        const unacknowledged = [];

        for (const assignment of assignments) {
            const ack = await TaskAcknowledgment.findOne({
                where: {
                    task_id: assignment.task_id,
                    user_id: userId,
                    acknowledge_date: today
                }
            });

            if (!ack || !ack.acknowledged_at) {
                unacknowledged.push({
                    task_id: assignment.task_id,
                    task_title: assignment.Task.title,
                    task_description: assignment.Task.description,
                    priority: assignment.Task.priority,
                    category: assignment.Task.category
                });
            }
        }

        res.json({
            date: today,
            count: unacknowledged.length,
            tasks: unacknowledged
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAcknowledgmentHistory = async (req, res) => {
    try {
        const userId = req.userId;
        const { days = 7 } = req.query; // Default to last 7 days

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        const acknowledgments = await TaskAcknowledgment.findAll({
            where: {
                acknowledge_date: {
                    [Op.gte]: startDate.toISOString().split('T')[0]
                }
            },
            include: [
                { model: Task, attributes: ['task_id', 'title', 'category', 'priority'] },
                { 
                    model: User, 
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'email'] },
                        { model: Faculty, attributes: ['name', 'email'] },
                        { model: Staff, attributes: ['name', 'email'] },
                        { model: RoleUser, attributes: ['name', 'email'] }
                    ]
                }
            ],
            order: [['acknowledge_date', 'DESC']]
        });

        const history = acknowledgments.map(ack => {
            const user = ack.User || {};
            const profile = user.Student || user.Faculty || user.Staff || user.RoleUser || {};
            return {
                task_id: ack.task_id,
                task_title: ack.Task?.title,
                task_category: ack.Task?.category,
                task_priority: ack.Task?.priority,
                acknowledge_date: ack.acknowledge_date,
                acknowledged_at: ack.acknowledged_at,
                user_id: ack.user_id,
                name: profile.name || user.name || 'Unknown',
                role: user.role || 'others',
                email: profile.email || user.email || '—',
                status: ack.acknowledged_at ? 'acknowledged' : 'pending'
            };
        });

        res.json({
            days: parseInt(days),
            count: history.length,
            acknowledgments: history
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Cron job function: Check morning acknowledgments (08:30 AM)
exports.checkMorningAcknowledgment = async () => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const { Leave } = require('../models');

        // --- NEW: Sunday Skip ---
        if (new Date().getDay() === 0) {
            console.log('[CRON] Skipping morning acknowledgment check - It is Sunday (Holiday).');
            return { count: 0 };
        }

        // 1. Find all users with active assignments for today
        const activeAssignments = await TaskAssign.findAll({
            where: {
                status: { [Op.in]: ['pending', 'accepted'] }
            },
            attributes: ['user_id', 'task_id'],
            include: [
                {
                    model: Task,
                    attributes: ['task_id', 'title'],
                    required: true
                },
                {
                    model: User,
                    attributes: ['user_id', 'role']
                }
            ]
        });

        if (activeAssignments.length === 0) return { count: 0 };

        const userIdsWithTasks = [...new Set(activeAssignments.map(a => a.user_id))];

        // Map users for easy access
        const userMap = {};
        activeAssignments.forEach(a => {
            if (a.User) userMap[a.user_id] = a.User;
        });

        // 2. Identify users on approved leave for today (Exempt)
        const approvedLeaves = await Leave.findAll({
            where: {
                status: 'approved',
                from_date: { [Op.lte]: today },
                to_date: { [Op.gte]: today }
            }
        });
        const userIdsOnLeave = new Set(approvedLeaves.map(l => l.user_id));

        // 3. Get all general acknowledgments for today
        const todaysGeneralAcks = await TaskAcknowledgment.findAll({
            where: {
                task_id: null,
                acknowledge_date: today,
                acknowledged_at: { [Op.ne]: null }
            }
        });
        const acknowledgedUserIds = new Set(todaysGeneralAcks.map(ack => ack.user_id));

        const { getSupervisor } = require('../utils/hierarchy');
        const TaskLog = require('../models').TaskLog;
        const TaskEscalation = require('../models').TaskEscalation;

        let escalationCount = 0;
        const supervisorCache = {}; // Cache to avoid N+1 queries

        // 4. Check each user with tasks
        for (const userId of userIdsWithTasks) {
            // Skip if on leave
            if (userIdsOnLeave.has(userId)) continue;

            // Skip if already acknowledged general awareness
            if (acknowledgedUserIds.has(userId)) continue;

            // Find supervisor for this user according to hierarchy
            const supervisorId = await getSupervisor(userId, supervisorCache);
            if (!supervisorId) continue; // No one to escalate to? Skip or fallback to admin

            // Get user details to check for student role
            const user = userMap[userId];
            const isStudent = user && user.role && user.role.toLowerCase() === 'student';

            // Escalate/Update all tasks for this user
            const userTasks = activeAssignments.filter(a => a.user_id === userId);
            for (const assign of userTasks) {
                if (isStudent) {
                    // Logic for students: Mark as rejected/absent, no formal escalation
                    await TaskAssign.update(
                        { status: 'rejected', reason: 'Absent (No Acknowledgement)' },
                        { where: { id: assign.id } }
                    );
                    
                    await TaskLog.create({
                        task_id: assign.task_id,
                        user_id: userId,
                        action: 'absence_auto_reject',
                        details: `Task auto-rejected (marked absent): Missing daily acknowledgement by 08:45 AM.`
                    });
                } else {
                    // Standard logic: Update assignment status and mark task escalated
                    await TaskAssign.update(
                        { status: 'escalated' },
                        { where: { id: assign.id } }
                    );
                    await Task.update(
                        { is_escalate: true },
                        { where: { task_id: assign.task_id } }
                    );

                    // 2. Create formal escalation record for the supervisor
                    await TaskEscalation.create({
                        task_id: assign.task_id,
                        reason: 'No Acknowledgement by 08:45 AM',
                        msg: `User did not acknowledge daily morning awareness for task "${assign.Task.title}".`,
                        creator_id: supervisorId, // "To" the supervisor
                        rejected_user_id: userId, // "From" the failing user
                        status: 'pending'
                    });

                    // 3. Log the action
                    await TaskLog.create({
                        task_id: assign.task_id,
                        user_id: userId,
                        action: 'escalation',
                        details: `Task escalated to User ${supervisorId}: Missing daily acknowledgement by 08:45 AM.`
                    });
                }
                escalationCount++;
            }
        }

        console.log(`[CRON] Morning acknowledgment check completed. Escalated ${escalationCount} tasks.`);
        return { count: escalationCount };

    } catch (error) {
        console.error('[CRON ERROR] checkMorningAcknowledgment:', error.message);
        return { error: error.message };
    }
};

// Cron job function: Cleanup old acknowledgments (01:00 AM)
exports.cleanupOldAcknowledgments = async () => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

        const result = await TaskAcknowledgment.destroy({
            where: {
                acknowledge_date: {
                    [Op.lt]: cutoffDate
                }
            }
        });

        console.log(`[CRON] Deleted ${result} acknowledgments older than ${cutoffDate}`);
        return { deleted: result };

    } catch (error) {
        console.error('[CRON ERROR] cleanupOldAcknowledgments:', error.message);
        return { error: error.message };
    }
};

// Get report of users who haven't acknowledged today (Admin only)
exports.getUnacknowledgedUsersReport = async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // 1. Get all active users who are not admins
        const users = await User.findAll({
            where: { role: { [Op.ne]: 'admin' }, status: 'active' },
            include: [
                { model: Student, attributes: ['name', 'email', 'department_id', 'year'] },
                { model: Faculty, attributes: ['name', 'email', 'department_id'] },
                { model: Staff, attributes: ['name', 'email', 'designation'] },
                { model: RoleUser, attributes: ['name', 'email'] },
                {
                    model: RoleAssignment,
                    include: [{ model: Role, attributes: ['user_role'] }]
                }
            ]
        });

        // 2. Get all acknowledgments for today
        const todaysAcks = await TaskAcknowledgment.findAll({
            where: { acknowledge_date: today, acknowledged_at: { [Op.ne]: null } },
            attributes: ['user_id']
        });

        const acknowledgedUserIds = new Set(todaysAcks.map(a => a.user_id));

        // 3. Filter unacknowledged users and categorize
        const report = {
            date: today,
            student: [],
            faculty: [],
            staff: [],
            hod: [],
            principal: [],
            incharge: [],
            others: []
        };

        for (const user of users) {
            if (!acknowledgedUserIds.has(user.user_id)) {
                const details = user.Student || user.Faculty || user.Staff || user.RoleUser;
                const userData = {
                    user_id: user.user_id,
                    role: user.role,
                    name: details?.name || 'Unknown',
                    email: details?.email || 'Unknown',
                    department_id: details?.department_id || null,
                    year: details?.year || null,
                    designation: details?.designation || null
                };

                // Specific categorization for role-users
                if (user.role === 'role-user') {
                    const roles = user.RoleAssignments?.map(ra => ra.Role?.user_role?.toLowerCase()) || [];
                    if (roles.includes('hod')) report.hod.push(userData);
                    else if (roles.includes('principal')) report.principal.push(userData);
                    else if (roles.includes('incharge')) report.incharge.push(userData);
                    else report.others.push(userData);
                } else if (user.role === 'student') {
                    report.student.push(userData);
                } else if (user.role === 'faculty') {
                    report.faculty.push(userData);
                } else if (user.role === 'staff') {
                    report.staff.push(userData);
                }
            }
        }

        res.json({
            success: true,
            total_unacknowledged:
                report.student.length + report.faculty.length + report.staff.length +
                report.hod.length + report.principal.length + report.incharge.length + report.others.length,
            report
        });

    } catch (error) {
        console.error('Error in getUnacknowledgedUsersReport:', error);
        res.status(500).json({ message: error.message });
    }
};

// General daily acknowledgement (Morning Awareness)
exports.acknowledgeGeneral = async (req, res) => {
    try {
        const adminId = req.userId;
        const adminRole = req.userRole;
        
        // Admin can specify a different user_id to acknowledge for them
        let targetUserId = adminId;
        if (adminRole === 'admin' && req.body.user_id) {
            targetUserId = req.body.user_id;
        }

        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const hour = localNow.getHours();
        const minute = localNow.getMinutes();
        const totalMinutes = hour * 60 + minute;

        // Window: 06:30 (390 mins) to 08:45 (525 mins)
        const startWindow = 6 * 60 + 30; // 390
        const endWindow = 8 * 60 + 45;   // 525

        // Bypass time check ONLY for Admin
        if (adminRole !== 'admin') {
            if (totalMinutes < startWindow || totalMinutes > endWindow) {
                return res.status(400).json({
                    success: false,
                    message: `Acknowledgement is only allowed between 06:30 AM and 08:45 AM. Current time is ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}.`
                });
            }
        }

        const today = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
        
        const taskId = req.body.task_id || null;

        // Create or update acknowledgment record
        const [ack, created] = await TaskAcknowledgment.findOrCreate({
            where: {
                task_id: taskId,
                user_id: targetUserId,
                acknowledge_date: today
            },
            defaults: {
                acknowledged_at: new Date()
            }
        });

        if (!created && !ack.acknowledged_at) {
            await ack.update({ acknowledged_at: new Date() });
        }

        res.json({
            success: true,
            message: adminRole === 'admin' && targetUserId !== adminId 
                ? `Daily morning awareness acknowledged for User ID ${targetUserId}.`
                : 'Daily morning awareness acknowledged. This confirms you are aware of your tasks for today.',
            acknowledged_at: ack.acknowledged_at,
            date: today,
            user_id: targetUserId
        });

    } catch (error) {
        console.error('Error in acknowledgeGeneral:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getTaskAcknowledgments = async (req, res) => {
    try {
        const { id } = req.params;
        const acks = await TaskAcknowledgment.findAll({
            where: { task_id: id }
        });
        res.json(acks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
