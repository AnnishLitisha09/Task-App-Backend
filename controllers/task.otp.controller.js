const { Task, TaskAssign, TaskOTP, TaskLog, User, Student, Faculty, Staff, RoleUser, TaskPackageClosure, TaskClosure } = require('../models');
const { Op } = require('sequelize');

/**
 * Generate a 6-digit OTP for a task assignment.
 * Restricted to the Task Creator.
 */
exports.generateOTP = async (req, res) => {
    try {
        const { assignment_id, task_id, type } = req.body; // type: 'START' or 'END'
        const userId = req.userId;

        if (!type || (!assignment_id && !task_id)) {
            return res.status(400).json({ success: false, message: "Type (START/END) and either assignment_id or task_id are required." });
        }

        let task = null;
        let finalAssignmentId = assignment_id || null;
        let finalTaskId = task_id || null;

        if (assignment_id) {
            const assignment = await TaskAssign.findOne({
                where: { id: assignment_id },
                include: [{
                    model: Task,
                    include: [{ model: TaskPackageClosure, include: [{ model: TaskClosure, attributes: ['name'] }] }]
                }]
            });
            if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found." });
            task = assignment.Task;
        } else {
            task = await Task.findByPk(task_id, {
                include: [{ model: TaskPackageClosure, include: [{ model: TaskClosure, attributes: ['name'] }] }]
            });
            if (!task) return res.status(404).json({ success: false, message: "Task not found." });
        }

        // 1. Permission Check
        const isCreator = task.creator_id == userId;
        let isAssignedFaculty = false;
        if (task.is_faculty && task.faculty_id) {
            const currentFaculty = await Faculty.findOne({ where: { user_id: userId } });
            if (currentFaculty && currentFaculty.id == task.faculty_id) {
                isAssignedFaculty = true;
            }
        }

        if (!isCreator && !isAssignedFaculty) {
            return res.status(403).json({ success: false, message: "Only the task creator or assigned faculty can generate OTPs." });
        }

        // Verify that the task requires an OTP
        const hasOtpClosure = task.TaskPackageClosures && task.TaskPackageClosures.some(c => c.TaskClosure && c.TaskClosure.name === 'otp');
        if (!hasOtpClosure) {
            return res.status(400).json({ success: false, message: "This task does not require an OTP closure method." });
        }

        // 2. Generate 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        // 3. Save OTP (Delete old unused ones for this target/type)
        await TaskOTP.destroy({
            where: {
                ...(finalAssignmentId ? { assignment_id: finalAssignmentId } : { task_id: finalTaskId }),
                otp_type: type,
                is_used: false
            }
        });

        const newOTP = await TaskOTP.create({
            assignment_id: finalAssignmentId,
            task_id: finalTaskId,
            otp_code: otpCode,
            otp_type: type,
            expires_at: expiresAt
        });

        res.json({
            success: true,
            otp: otpCode,
            expires_in: "10 minutes",
            type: type,
            scope: finalAssignmentId ? "individual" : "universal"
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

        const currentFaculty = await Faculty.findOne({ where: { user_id: userId } });
        const facultyId = currentFaculty ? currentFaculty.id : null;

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
                    where: {
                        [Op.or]: [
                            { creator_id: userId },
                            ...(facultyId ? [{ is_faculty: true, faculty_id: facultyId }] : [])
                        ]
                    },
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
        console.error("GET OTPS ERROR:", error);
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

        // 1. Find OTP (Check individual first, then universal)
        let otpRecord = await TaskOTP.findOne({
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
            // Check for Universal OTP
            const assignment = await TaskAssign.findByPk(assignment_id, {
                include: [{ model: Task, include: [{ model: require('../models').TaskType }] }],
                transaction: t
            });

            if (!assignment) {
                await t.rollback();
                return res.status(404).json({ success: false, message: "Assignment not found." });
            }

            otpRecord = await TaskOTP.findOne({
                where: {
                    task_id: assignment.task_id,
                    otp_code,
                    expires_at: { [Op.gt]: new Date() }
                    // Universal OTPs don't use the is_used flag in the same way 
                    // because multiple students use the same code.
                },
                transaction: t
            });

            if (otpRecord) {
                // Attach the assignment so the rest of the logic works
                otpRecord.TaskAssign = assignment;
            }
        }

        if (!otpRecord) {
            await t.rollback();
            return res.status(400).json({ success: false, message: "Invalid or expired OTP." });
        }

        const assignment = otpRecord.TaskAssign;
        const task = assignment.Task;

        // 2. Security Check: Only creator, assignee, or faculty supervisor
        const isCreator = task.creator_id === userId;
        const isAssignee = assignment.user_id === userId;
        let isFacultySupervisor = false;

        if (task.is_faculty && task.faculty_id) {
            const currentFaculty = await Faculty.findOne({ where: { user_id: userId } });
            if (currentFaculty && currentFaculty.id == task.faculty_id) {
                isFacultySupervisor = true;
            }
        }

        if (!isCreator && !isAssignee && !isFacultySupervisor) {
            await t.rollback();
            return res.status(403).json({ success: false, message: "Verification failed: You are not the assignee or an authorized supervisor for this task." });
        }

        const taskType = task.TaskTypes?.[0];

        // 3. Process based on Type
        if (otpRecord.otp_type === 'START') {
            // --- NEW: Deadline Check ---
            if (taskType && taskType.end_date) {
                const timeStr = taskType.end_time || '23:59:59';
                const deadlineStr = `${taskType.end_date}T${timeStr}`;
                const deadline = new Date(deadlineStr);
                if (new Date() > deadline) {
                    await t.rollback();
                    return res.status(400).json({
                        success: false,
                        message: "Activity window has passed. This task is marked as missed."
                    });
                }
            }

            await assignment.update({ status: 'in_progress' }, { transaction: t });
            await TaskLog.create({
                task_id: task.task_id,
                user_id: userId,
                action: 'mark_attendance',
                details: 'Attendance marked via START OTP'
            }, { transaction: t });

            if (otpRecord.assignment_id) {
                await otpRecord.update({ is_used: true }, { transaction: t });
            }
            await t.commit();

            return res.json({ success: true, message: "Attendance marked. Task is now in-progress.", status: 'in_progress' });

        } else if (otpRecord.otp_type === 'END') {
            // Logic similar to submitTaskProof but without physical proof requirement
            let penalty = 0;
            let earnedScore = 0;

            if (req.body.obtained_score !== undefined && req.body.penalty !== undefined) {
                penalty = parseFloat(req.body.penalty);
                earnedScore = parseFloat(req.body.obtained_score);
            } else {
                const now = new Date();
                const deadline = taskType?.end_date ? new Date(taskType.end_date) : null;

                if (deadline && now > deadline) {
                    const diffMs = now - deadline;
                    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
                    penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
                }

                earnedScore = parseFloat(task.score || 0) - penalty;
            }

            let proof = null;
            if (req.file) {
                // If it's a local file upload (via multer)
                proof = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
            } else if (req.body.proof) {
                // If proof URL search passed as string
                proof = req.body.proof;
            }

            await assignment.update({
                status: 'completed',
                proof: proof,
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

            if (otpRecord.assignment_id) {
                await otpRecord.update({ is_used: true }, { transaction: t });
            }
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

        const currentFaculty = await Faculty.findOne({ where: { user_id: userId } });
        const facultyId = currentFaculty ? currentFaculty.id : null;

        const tasks = await Task.findAll({
            where: {
                [Op.or]: [
                    { creator_id: userId },
                    ...(facultyId ? [{ is_faculty: true, faculty_id: facultyId }] : [])
                ],
                is_deleted: false
            },
            include: [{
                model: TaskAssign,
                include: [
                    { model: User, attributes: ['user_id', 'role', 'name'] },
                    { model: TaskOTP, where: { assignment_id: { [Op.ne]: null } }, required: false, limit: 5, order: [['created_at', 'DESC']] }
                ]
            }, {
                model: TaskType
            }, {
                model: TaskOTP,
                where: { assignment_id: null }, // Universal OTPs
                required: false,
                limit: 5,
                order: [['created_at', 'DESC']]
            }],
            order: [['created_at', 'DESC']]
        });

        const formatted = [];
        tasks.forEach(task => {
            const universalOTPs = task.TaskOTPs || [];
            task.TaskAssigns.forEach(assignment => {
                formatted.push({
                    assignment_id: assignment.id,
                    task_id: task.task_id,
                    title: task.title,
                    assignee: assignment.User,
                    status: assignment.status,
                    proof: assignment.proof,
                    submitted_time: assignment.submitted_time,
                    individual_otps: assignment.TaskOTPs,
                    universal_otps: universalOTPs,
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
