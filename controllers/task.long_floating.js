const { Task, TaskType, TaskAssign, TaskLog, User, Student, Faculty, Staff, RoleUser, Notification } = require('../models');
const { Op } = require('sequelize');
const path = require('path');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const LONG_TASK_NAMES = ['Date-Only / Long Task', 'Long Task'];
const FLOATING_TASK_NAME = 'Floating Task';

const getAssignmentWithTask = async (assignmentId, userId) => {
    const assignment = await TaskAssign.findOne({
        where: { id: assignmentId, user_id: userId },
        include: [{
            model: Task,
            where: { is_deleted: false },
            include: [{ model: TaskType }]
        }]
    });
    return assignment;
};

const getTaskTypeCategory = (taskTypes) => {
    if (!taskTypes || taskTypes.length === 0) return 'unknown';
    const name = taskTypes[0].task_name;
    if (LONG_TASK_NAMES.includes(name)) return 'long';
    if (name === FLOATING_TASK_NAME) return 'floating';
    return name;
};

const sendNotification = async (userId, title, msg, type) => {
    try {
        await Notification.create({ user_id: userId, title, msg, type });
    } catch (e) {
        console.error('Notification error:', e.message);
    }
};

// ─── LONG TASK: START ─────────────────────────────────────────────────────────
/**
 * POST /api/tasks/long/start
 * Body: { assignment_id }
 *
 * Marks a Long Task assignment as in_progress (no OTP needed).
 * Only works if the task is within its start_date → end_date range.
 */
exports.startLongTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { assignment_id } = req.body;
        const userId = req.userId;

        if (!assignment_id) {
            return res.status(400).json({ success: false, message: 'assignment_id is required.' });
        }

        const assignment = await getAssignmentWithTask(assignment_id, userId);
        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const task = assignment.Task;
        const category = getTaskTypeCategory(task.TaskTypes);
        if (category !== 'long') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'This endpoint is only for Long Tasks.' });
        }

        if (!['accepted', 'paused'].includes(assignment.status)) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `Cannot start a task with status "${assignment.status}". Must be accepted or paused.`
            });
        }

        // Date range check
        const tt = task.TaskTypes[0];
        const now = new Date();
        const startDate = tt.start_date ? new Date(tt.start_date) : null;
        const endDate = tt.end_date ? new Date(new Date(tt.end_date).setHours(23, 59, 59, 999)) : null;

        if (startDate && now < startDate) {
            await t.rollback();
            return res.status(403).json({
                success: false,
                message: `Task hasn't started yet. Start date: ${tt.start_date}.`
            });
        }
        if (endDate && now > endDate) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `Task deadline has passed (${tt.end_date}). Cannot start.`
            });
        }

        await assignment.update({ status: 'in_progress' }, { transaction: t });
        await TaskLog.create({
            task_id: task.task_id,
            user_id: userId,
            action: 'long_task_started',
            details: `Long Task started by user ${userId} at ${now.toISOString()}`
        }, { transaction: t });

        await t.commit();

        sendNotification(task.creator_id, 'Long Task Started',
            `"${task.title}" was started by user ${userId}.`, 'task_update');

        res.json({ success: true, message: 'Long Task started successfully.', status: 'in_progress' });

    } catch (error) {
        await t.rollback();
        console.error('START LONG TASK ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── LONG TASK: PAUSE ─────────────────────────────────────────────────────────
/**
 * POST /api/tasks/long/pause
 * Body: { assignment_id, reason? }
 *
 * Pauses an in-progress Long Task.
 * Logs the pause session.
 */
exports.pauseLongTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { assignment_id, reason } = req.body;
        const userId = req.userId;

        if (!assignment_id) {
            return res.status(400).json({ success: false, message: 'assignment_id is required.' });
        }

        const assignment = await getAssignmentWithTask(assignment_id, userId);
        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const task = assignment.Task;
        const category = getTaskTypeCategory(task.TaskTypes);
        if (category !== 'long') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'This endpoint is only for Long Tasks.' });
        }

        if (assignment.status !== 'in_progress') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `Cannot pause a task with status "${assignment.status}". Task must be in_progress.`
            });
        }

        // Long Tasks always allow pausing — auto-enable the flag if it wasn't set (backfill old tasks)
        if (!task.is_pause_allowed) {
            await task.update({ is_pause_allowed: true }, { transaction: t });
        }

        await assignment.update({ status: 'paused' }, { transaction: t });
        await task.update({ is_paused: true }, { transaction: t });
        await TaskLog.create({
            task_id: task.task_id,
            user_id: userId,
            action: 'long_task_paused',
            details: `Long Task paused at ${new Date().toISOString()}. Reason: ${reason || 'N/A'}`
        }, { transaction: t });

        await t.commit();

        res.json({
            success: true,
            message: 'Long Task paused. You can resume anytime within the task window.',
            status: 'paused'
        });

    } catch (error) {
        await t.rollback();
        console.error('PAUSE LONG TASK ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── LONG TASK: RESUME ────────────────────────────────────────────────────────
/**
 * POST /api/tasks/long/resume
 * Body: { assignment_id }
 *
 * Resumes a paused Long Task.
 * Calendar is NOT changed — only status is updated.
 */
exports.resumeLongTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { assignment_id } = req.body;
        const userId = req.userId;

        if (!assignment_id) {
            return res.status(400).json({ success: false, message: 'assignment_id is required.' });
        }

        const assignment = await getAssignmentWithTask(assignment_id, userId);
        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const task = assignment.Task;
        const category = getTaskTypeCategory(task.TaskTypes);
        if (category !== 'long') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'This endpoint is only for Long Tasks.' });
        }

        if (assignment.status !== 'paused') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `Cannot resume a task with status "${assignment.status}". Task must be paused.`
            });
        }

        // Deadline check before resuming
        const tt = task.TaskTypes[0];
        const now = new Date();
        const endDate = tt?.end_date ? new Date(new Date(tt.end_date).setHours(23, 59, 59, 999)) : null;
        if (endDate && now > endDate) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `Task deadline has passed (${tt.end_date}). Cannot resume.`
            });
        }

        await assignment.update({ status: 'in_progress' }, { transaction: t });
        await task.update({ is_paused: false }, { transaction: t });
        await TaskLog.create({
            task_id: task.task_id,
            user_id: userId,
            action: 'long_task_resumed',
            details: `Long Task resumed at ${now.toISOString()}`
        }, { transaction: t });

        await t.commit();

        res.json({
            success: true,
            message: 'Long Task resumed successfully.',
            status: 'in_progress'
        });

    } catch (error) {
        await t.rollback();
        console.error('RESUME LONG TASK ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── LONG TASK: COMPLETE (Upload Proof) ──────────────────────────────────────
/**
 * POST /api/tasks/long/complete   (multipart/form-data)
 * Body: { assignment_id }
 * File: proof (required — photo/document)
 *
 * Completes a Long Task. NO OTP is used.
 * Proof file is mandatory.
 */
exports.completeLongTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { assignment_id } = req.body;
        const userId = req.userId;

        if (!assignment_id) {
            return res.status(400).json({ success: false, message: 'assignment_id is required.' });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Proof file is required to complete a Long Task. Please upload a photo or document.'
            });
        }

        const assignment = await getAssignmentWithTask(assignment_id, userId);
        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const task = assignment.Task;
        const category = getTaskTypeCategory(task.TaskTypes);
        if (category !== 'long') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'This endpoint is only for Long Tasks.' });
        }

        if (!['in_progress', 'accepted', 'paused'].includes(assignment.status)) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `Cannot complete a task with status "${assignment.status}".`
            });
        }

        const proofPath = `/uploads/submissions/${req.file.filename}`;
        const now = new Date();

        // Penalty calculation
        const tt = task.TaskTypes[0];
        let penalty = 0;
        let earnedScore = parseFloat(task.score || 0);

        if (tt?.end_date) {
            const deadline = new Date(new Date(tt.end_date).setHours(23, 59, 59, 999));
            if (now > deadline) {
                const diffHours = Math.ceil((now - deadline) / (1000 * 60 * 60));
                penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
                earnedScore = Math.max(0, earnedScore - penalty);
            }
        }

        await assignment.update({
            status: 'completed',
            proof: proofPath,
            submitted_time: now,
            earned_score: earnedScore,
            penalty_applied: penalty
        }, { transaction: t });

        // Update profile score
        const user = await User.findByPk(userId, { transaction: t });
        let profile = null;
        if (user.role === 'student') profile = await Student.findOne({ where: { user_id: userId }, transaction: t });
        else if (user.role === 'faculty') profile = await Faculty.findOne({ where: { user_id: userId }, transaction: t });
        else if (user.role === 'staff') profile = await Staff.findOne({ where: { user_id: userId }, transaction: t });
        else if (user.role === 'role-user') profile = await RoleUser.findOne({ where: { user_id: userId }, transaction: t });

        if (profile) {
            await profile.update({
                score: parseFloat(profile.score || 0) + earnedScore,
                penalty: parseFloat(profile.penalty || 0) + penalty,
                total_score: parseFloat(profile.total_score || 0) + parseFloat(task.score || 0)
            }, { transaction: t });
        }

        await TaskLog.create({
            task_id: task.task_id,
            user_id: userId,
            action: 'long_task_completed_with_proof',
            details: `Long Task completed at ${now.toISOString()}. Proof: ${proofPath}. Score: ${earnedScore}, Penalty: ${penalty}`
        }, { transaction: t });

        await t.commit();

        sendNotification(task.creator_id, 'Long Task Proof Submitted',
            `"${task.title}" has been completed by user ${userId}. Please review the proof.`, 'task_proof_submitted');

        res.json({
            success: true,
            message: 'Long Task completed successfully. Proof submitted for review.',
            proof: proofPath,
            score_earned: earnedScore,
            penalty_applied: penalty,
            status: 'completed'
        });

    } catch (error) {
        await t.rollback();
        console.error('COMPLETE LONG TASK ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── LONG TASK: GET SESSION LOGS ──────────────────────────────────────────────
/**
 * GET /api/tasks/long/:assignment_id/sessions
 *
 * Returns all pause/resume/start session logs for a Long Task assignment.
 */
exports.getLongTaskSessions = async (req, res) => {
    try {
        const { assignment_id } = req.params;
        const userId = req.userId;

        const assignment = await TaskAssign.findOne({
            where: { id: assignment_id, user_id: userId },
            include: [{ model: Task, where: { is_deleted: false } }]
        });
        if (!assignment) {
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const logs = await TaskLog.findAll({
            where: {
                task_id: assignment.task_id,
                user_id: userId,
                action: { [Op.in]: ['long_task_started', 'long_task_paused', 'long_task_resumed', 'long_task_completed_with_proof'] }
            },
            order: [['created_at', 'ASC']]
        });

        res.json({
            success: true,
            assignment_id: assignment.id,
            task_title: assignment.Task.title,
            current_status: assignment.status,
            session_count: logs.filter(l => l.action === 'long_task_started' || l.action === 'long_task_resumed').length,
            sessions: logs.map(l => ({
                action: l.action,
                details: l.details,
                timestamp: l.created_at
            }))
        });

    } catch (error) {
        console.error('GET LONG TASK SESSIONS ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── FLOATING TASK: COMPLETE ──────────────────────────────────────────────────
/**
 * POST /api/tasks/floating/complete   (multipart/form-data)
 * Body: { assignment_id, otp_code? }
 * File: proof? (optional — if OTP not provided)
 *
 * Completes a Floating Task.
 * Accepts: END OTP OR proof file (at least one required).
 */
exports.completeFloatingTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { assignment_id, otp_code } = req.body;
        const userId = req.userId;

        if (!assignment_id) {
            return res.status(400).json({ success: false, message: 'assignment_id is required.' });
        }

        if (!otp_code && !req.file) {
            return res.status(400).json({
                success: false,
                message: 'Either an OTP code or a proof file is required to complete a Floating Task.'
            });
        }

        const assignment = await getAssignmentWithTask(assignment_id, userId);
        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Assignment not found.' });
        }

        const task = assignment.Task;
        const category = getTaskTypeCategory(task.TaskTypes);
        if (category !== 'floating') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'This endpoint is only for Floating Tasks.' });
        }

        if (['completed', 'rejected'].includes(assignment.status)) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: `Task is already ${assignment.status}.`
            });
        }

        // Deadline check
        const tt = task.TaskTypes[0];
        const now = new Date();
        if (tt?.end_date) {
            const deadline = new Date(new Date(tt.end_date).setHours(23, 59, 59, 999));
            if (now > deadline) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Floating Task deadline passed on ${tt.end_date}. Cannot complete.`
                });
            }
        }

        // OTP verification if provided
        if (otp_code) {
            const { TaskOTP } = require('../models');
            const otpRecord = await TaskOTP.findOne({
                where: {
                    [Op.or]: [
                        { assignment_id, otp_code, is_used: false, expires_at: { [Op.gt]: now } },
                        { task_id: task.task_id, otp_code, expires_at: { [Op.gt]: now } }
                    ]
                },
                transaction: t
            });

            if (!otpRecord) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
            }

            if (otpRecord.assignment_id) {
                await otpRecord.update({ is_used: true }, { transaction: t });
            }
        }

        const proofPath = req.file ? `/uploads/submissions/${req.file.filename}` : null;

        // Penalty calcuation
        let penalty = 0;
        let earnedScore = parseFloat(task.score || 0);
        if (tt?.end_date) {
            const deadline = new Date(new Date(tt.end_date).setHours(23, 59, 59, 999));
            if (now > deadline) {
                const diffHours = Math.ceil((now - deadline) / (1000 * 60 * 60));
                penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
                earnedScore = Math.max(0, earnedScore - penalty);
            }
        }

        await assignment.update({
            status: 'completed',
            proof: proofPath,
            submitted_time: now,
            earned_score: earnedScore,
            penalty_applied: penalty
        }, { transaction: t });

        // Update profile score
        const user = await User.findByPk(userId, { transaction: t });
        let profile = null;
        if (user.role === 'student') profile = await Student.findOne({ where: { user_id: userId }, transaction: t });
        else if (user.role === 'faculty') profile = await Faculty.findOne({ where: { user_id: userId }, transaction: t });
        else if (user.role === 'staff') profile = await Staff.findOne({ where: { user_id: userId }, transaction: t });
        else if (user.role === 'role-user') profile = await RoleUser.findOne({ where: { user_id: userId }, transaction: t });

        if (profile) {
            await profile.update({
                score: parseFloat(profile.score || 0) + earnedScore,
                penalty: parseFloat(profile.penalty || 0) + penalty,
                total_score: parseFloat(profile.total_score || 0) + parseFloat(task.score || 0)
            }, { transaction: t });
        }

        await TaskLog.create({
            task_id: task.task_id,
            user_id: userId,
            action: 'floating_task_completed',
            details: `Floating Task completed at ${now.toISOString()}. Method: ${otp_code ? 'OTP' : 'Proof Upload'}. Score: ${earnedScore}`
        }, { transaction: t });

        await t.commit();

        sendNotification(task.creator_id, 'Floating Task Completed',
            `"${task.title}" was completed by user ${userId}.`, 'task_completed');

        res.json({
            success: true,
            message: 'Floating Task completed successfully.',
            method_used: otp_code ? 'OTP' : 'Proof Upload',
            proof: proofPath,
            score_earned: earnedScore,
            penalty_applied: penalty,
            status: 'completed'
        });

    } catch (error) {
        await t.rollback();
        console.error('COMPLETE FLOATING TASK ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
