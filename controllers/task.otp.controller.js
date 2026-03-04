const { Task, TaskAssign, TaskOTP, TaskLog, User, Student, Faculty, Staff, RoleUser } = require('../models');
const { Op } = require('sequelize');

/**
 * Generate a 6-digit OTP for a task assignment.
 * Restricted to the Task Creator.
 */
exports.generateOTP = async (req, res) => {
    try {
        const { assignment_id, type } = req.body; // type: 'START' or 'END'
        const userId = req.userId;

        if (!assignment_id || !type) {
            return res.status(400).json({ success: false, message: "assignment_id and type (START/END) are required." });
        }

        // 1. Verify Assignment and Creator
        const assignment = await TaskAssign.findOne({
            where: { id: assignment_id },
            include: [{ model: Task, attributes: ['creator_id'] }]
        });

        if (!assignment) {
            return res.status(404).json({ success: false, message: "Assignment not found." });
        }

        if (assignment.Task.creator_id != userId) {
            return res.status(403).json({ success: false, message: "Only the task creator can generate OTPs." });
        }

        // 2. Generate 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 20 * 1000); // 20 seconds from now

        // 3. Save OTP (Delete old unused ones for this assignment/type if any)
        await TaskOTP.destroy({
            where: { assignment_id, otp_type: type, is_used: false }
        });

        const newOTP = await TaskOTP.create({
            assignment_id,
            otp_code: otpCode,
            otp_type: type,
            expires_at: expiresAt
        });

        res.json({
            success: true,
            otp: otpCode,
            expires_in: "20 seconds",
            type: type
        });

    } catch (error) {
        console.error("GENERATE OTP ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get all active (unused/not expired) OTPs for tasks created by the user.
 */
exports.getGeneratedOTPs = async (req, res) => {
    try {
        const userId = req.userId;

        const activeOTPs = await TaskOTP.findAll({
            where: {
                is_used: false,
                expires_at: { [Op.gt]: new Date() }
            },
            include: [{
                model: TaskAssign,
                required: true,
                include: [{
                    model: Task,
                    where: { creator_id: userId },
                    attributes: ['task_id', 'title']
                }, {
                    model: User,
                    attributes: ['user_id', 'role']
                }]
            }]
        });

        res.json({
            success: true,
            count: activeOTPs.length,
            otps: activeOTPs.map(o => ({
                otp_id: o.otp_id,
                code: o.otp_code,
                type: o.otp_type,
                expires_at: o.expires_at,
                task_title: o.TaskAssign.Task.title,
                assignee_id: o.TaskAssign.user_id
            }))
        });

    } catch (error) {
        console.error("GET OTBS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Verify OTP and update task status.
 * START -> Attendance (in_progress)
 * END -> Completion (completed + Score)
 */
exports.verifyOTP = async (req, res) => {
    const t = await TaskOTP.sequelize.transaction();
    try {
        const { assignment_id, otp_code } = req.body;
        const userId = req.userId;

        if (!assignment_id || !otp_code) {
            return res.status(400).json({ success: false, message: "assignment_id and otp_code are required." });
        }

        // 1. Find OTP
        const otpRecord = await TaskOTP.findOne({
            where: {
                assignment_id,
                otp_code,
                is_used: false,
                expires_at: { [Op.gt]: new Date() }
            },
            include: [{
                model: TaskAssign,
                include: [{ model: Task, include: [{ model: require('../models').TaskType }] }]
            }],
            transaction: t
        });

        if (!otpRecord) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP." });
        }

        const assignment = otpRecord.TaskAssign;

        // 2. Security Check: Only Assignee can verify
        if (assignment.user_id != userId) {
            await t.rollback();
            return res.status(403).json({ success: false, message: "Verification failed: You are not the assignee." });
        }

        const task = assignment.Task;
        const taskType = task.TaskTypes?.[0];

        // 3. Process based on Type
        if (otpRecord.otp_type === 'START') {
            await assignment.update({ status: 'in_progress' }, { transaction: t });
            await TaskLog.create({
                task_id: task.task_id,
                user_id: userId,
                action: 'mark_attendance',
                details: 'Attendance marked via START OTP'
            }, { transaction: t });

            await otpRecord.update({ is_used: true }, { transaction: t });
            await t.commit();

            return res.json({ success: true, message: "Attendance marked. Task is now in-progress.", status: 'in_progress' });

        } else if (otpRecord.otp_type === 'END') {
            // Logic similar to submitTaskProof but without physical proof requirement
            let penalty = 0;
            const now = new Date();
            const deadline = taskType?.end_date ? new Date(taskType.end_date) : null;

            if (deadline && now > deadline) {
                const diffMs = now - deadline;
                const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
                penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
            }

            const earnedScore = parseFloat(task.score || 0) - penalty;

            await assignment.update({
                status: 'completed',
                submitted_time: now,
                earned_score: earnedScore,
                penalty_applied: penalty
            }, { transaction: t });

            // Update Profile Scores
            const user = await User.findByPk(userId, { transaction: t });
            let profile = null;
            if (user.role === 'student') profile = await Student.findOne({ where: { user_id: userId }, transaction: t });
            else if (user.role === 'faculty') profile = await Faculty.findOne({ where: { user_id: userId }, transaction: t });
            else if (user.role === 'role-user') profile = await RoleUser.findOne({ where: { user_id: userId }, transaction: t });
            else if (user.role === 'staff') profile = await Staff.findOne({ where: { user_id: userId }, transaction: t });

            if (profile) {
                await profile.update({
                    score: parseFloat(profile.score || 0) + earnedScore,
                    penalty: parseFloat(profile.penalty || 0) + penalty,
                    total_score: parseFloat(profile.total_score || 0) + parseFloat(task.score)
                }, { transaction: t });
            }

            await TaskLog.create({
                task_id: task.task_id,
                user_id: userId,
                action: 'complete_otp',
                details: 'Task completed via END OTP'
            }, { transaction: t });

            await otpRecord.update({ is_used: true }, { transaction: t });
            await t.commit();

            return res.json({
                success: true,
                message: "Task completed successfully via OTP.",
                score_earned: earnedScore,
                penalty_applied: penalty,
                status: 'completed'
            });
        }

    } catch (error) {
        if (t) await t.rollback();
        console.error("VERIFY OTP ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get all assignments for tasks created by the user, 
 * including their current completion/OTP status and proof.
 */
exports.getCreatorTaskAssignments = async (req, res) => {
    try {
        const userId = req.userId;
        const { limit, offset, page } = { limit: 50, offset: 0, page: 1 }; // Default simple pagination

        const tasks = await Task.findAll({
            where: { creator_id: userId, is_deleted: false },
            include: [{
                model: TaskAssign,
                include: [
                    { model: User, attributes: ['user_id', 'role'] },
                    { model: TaskOTP, limit: 5, order: [['created_at', 'DESC']] }
                ]
            }, {
                model: TaskType
            }],
            order: [['created_at', 'DESC']]
        });

        const formatted = [];
        tasks.forEach(task => {
            task.TaskAssigns.forEach(assignment => {
                formatted.push({
                    assignment_id: assignment.id,
                    task_id: task.task_id,
                    title: task.title,
                    assignee: assignment.User,
                    status: assignment.status,
                    proof: assignment.proof,
                    submitted_time: assignment.submitted_time,
                    otps: assignment.TaskOTPs,
                    timing: task.TaskTypes?.[0] ? `${task.TaskTypes[0].start_time} - ${task.TaskTypes[0].end_time}` : 'N/A'
                });
            });
        });

        res.json({
            success: true,
            count: formatted.length,
            assignments: formatted
        });

    } catch (error) {
        console.error("GET CREATOR ASSIGNMENTS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
