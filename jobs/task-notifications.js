const { Task, TaskType, TaskAssign, TaskOTP, User, Notification, TaskPackageClosure, TaskClosure } = require('../models');
const { Op, literal } = require('sequelize');

/**
 * Helper to create a notification
 */
const sendNotification = async (userId, title, msg, type = 'general') => {
    if (!userId) return;
    try {
        await Notification.create({
            user_id: userId,
            title,
            msg,
            type
        });
    } catch (error) {
        console.error(`[NOTIFICATION] Failed to send to ${userId}:`, error.message);
    }
};

/**
 * Pre-Task Notification: Notify creator/faculty 10 minutes before a task starts.
 * This runs every minute.
 */
const runStart10MinReminderJob = async () => {
    try {
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Target time is exactly 10 minutes from now (ignoring seconds)
        localNow.setMinutes(localNow.getMinutes() + 10);
        const targetTimeStr = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}:00`;

        const tasksToStart = await Task.findAll({
            where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
            include: [{
                model: TaskType,
                required: true,
                where: {
                    start_date: dateStr,
                    start_time: targetTimeStr
                }
            }]
        });

        for (const task of tasksToStart) {
            const msg = `Your assigned task "${task.title}" is scheduled to start in 10 minutes.`;
            await sendNotification(task.creator_id, "Task Starting Soon", msg);
            if (task.is_faculty && task.faculty_id) {
                await sendNotification(task.faculty_id, "Task Starting Soon", msg);
            }
        }
    } catch (error) {
        console.error("10 MIN REMINDER CRON ERROR:", error);
    }
};

/**
 * OTP Progress Summary: periodic check (e.g. 15 mins after start/end time)
 * Notifies creator/faculty about how many students have entered START and END OTPs.
 * Since a pure time match might be complex if tasks have arbitrary times, 
 * an alternative is to just run this every 15 minutes, query active tasks 
 * that require OTP, and hit "15 min after" or "45 min after" etc.
 * Here we explicitly look for tasks that started 15 mins ago OR ended 15 mins ago.
 */
const runOtpProgressSummaryJob = async () => {
    try {
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Start Check: 15 mins after start
        const localStartCheck = new Date(localNow);
        localStartCheck.setMinutes(localStartCheck.getMinutes() - 15);
        const targetStartTimeStr = `${String(localStartCheck.getHours()).padStart(2, '0')}:${String(localStartCheck.getMinutes()).padStart(2, '0')}:00`;

        // End Check: 15 mins after end
        const localEndCheck = new Date(localNow);
        localEndCheck.setMinutes(localEndCheck.getMinutes() - 15);
        const targetEndTimeStr = `${String(localEndCheck.getHours()).padStart(2, '0')}:${String(localEndCheck.getMinutes()).padStart(2, '0')}:00`;

        const tasks15MinAfterStart = await Task.findAll({
            where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
            include: [{
                model: TaskType,
                required: true,
                where: { start_date: dateStr, start_time: targetStartTimeStr }
            }, {
                model: TaskAssign,
                include: [{ model: TaskOTP, where: { otp_type: 'START', is_used: true }, required: false }]
            }]
        });

        for (const task of tasks15MinAfterStart) {
            // Count total assignees vs how many used the START OTP
            const totalAssignees = task.TaskAssigns.length;
            const completedStart = task.TaskAssigns.filter(a => a.TaskOTPs && a.TaskOTPs.length > 0).length;

            const msg = `Update for "${task.title}": ${completedStart} out of ${totalAssignees} students have entered the START OTP.`;
            await sendNotification(task.creator_id, "START OTP Progress", msg);
            if (task.is_faculty && task.faculty_id) {
                await sendNotification(task.faculty_id, "START OTP Progress", msg);
            }
        }

        const tasks15MinAfterEnd = await Task.findAll({
            where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
            include: [{
                model: TaskType,
                required: true,
                where: { end_date: dateStr, end_time: targetEndTimeStr }
            }, {
                model: TaskAssign,
                include: [{ model: TaskOTP, where: { otp_type: 'END', is_used: true }, required: false }]
            }]
        });

        for (const task of tasks15MinAfterEnd) {
            // Count total assignees vs how many used the END OTP
            const totalAssignees = task.TaskAssigns.length;
            const completedEnd = task.TaskAssigns.filter(a => a.TaskOTPs && a.TaskOTPs.length > 0).length;

            const msg = `Update for "${task.title}": ${completedEnd} out of ${totalAssignees} students have entered the END OTP.`;
            await sendNotification(task.creator_id, "END OTP Progress", msg);
            if (task.is_faculty && task.faculty_id) {
                await sendNotification(task.faculty_id, "END OTP Progress", msg);
            }
        }
    } catch (error) {
        console.error("OTP PROGRESS SUMMARY CRON ERROR:", error);
    }
};

/**
 * Document Summary: End-of-Day Document Summary (e.g. at 9:00 PM).
 * Scans tasks that ended today and required document closure.
 * Compiles a list: submitted document, only submitted OTP, missed entirely.
 */
const runDocumentSummaryJob = async () => {
    try {
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Find tasks ending today with is_document = true OR with a document closure via TaskPackageClosure
        const completedDocsTasks = await Task.findAll({
            where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
            include: [{
                model: TaskType,
                required: true,
                where: { end_date: dateStr }
            }, {
                model: TaskAssign,
                include: [
                    { model: User, attributes: ['user_id', 'role'], include: [require('../models').Student] },
                    { model: TaskOTP, required: false }
                ]
            }]
        });

        for (const task of completedDocsTasks) {
            // Check if document was required:
            // Either task.is_document is true, OR there are closures indicating 'document' or 'image'
            const isDocsReq = task.is_document === true; // Simplified check since packages might also have is_document set.
            if (!isDocsReq) {
                // Check task closures
                const closures = await TaskPackageClosure.findAll({
                    where: { task_id: task.task_id },
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                });
                const needsDocs = closures.some(c => ['document', 'image'].includes(c.TaskClosure.name));
                if (!needsDocs) continue; // Skip tasks without document requirements
            }

            const submittedDocs = [];
            const onlyOTPs = [];
            const missedAll = [];

            for (const assign of task.TaskAssigns) {
                const userName = assign.User?.Student?.name || `ID: ${assign.user_id}`;
                const hasProof = assign.proof && assign.proof.trim() !== '';
                const hasOTP = assign.TaskOTPs && assign.TaskOTPs.length > 0;

                if (hasProof) {
                    submittedDocs.push(userName);
                } else if (hasOTP && !hasProof) {
                    onlyOTPs.push(userName);
                } else {
                    missedAll.push(userName);
                }
            }

            let msg = `Daily Document Summary for "${task.title}":\n`;
            msg += `- Submitted Documentation: ${submittedDocs.length} students.\n`;
            msg += `- Did not submit Document (Only OTPs): ${onlyOTPs.length} students.\n`;
            msg += `- Missed Entirely: ${missedAll.length} students.`;

            await sendNotification(task.creator_id, "End-Of-Day Documentation Summary", msg);
            if (task.is_faculty && task.faculty_id) {
                await sendNotification(task.faculty_id, "End-Of-Day Documentation Summary", msg);
            }
        }
    } catch (error) {
        console.error("DOCUMENT SUMMARY CRON ERROR:", error);
    }
};

/**
 * Pre-Task Student Status Notification: Notify creator 2 hours before a task starts
 * about the acceptance status of student assignees.
 * Runs every minute.
 */
const runPreTaskStudentStatusJob = async () => {
    try {
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Target time is exactly 2 hours (120 minutes) from now
        localNow.setMinutes(localNow.getMinutes() + 120);
        const targetTimeStr = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}:00`;

        const tasksStartingSoon = await Task.findAll({
            where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
            include: [
                {
                    model: TaskType,
                    required: true,
                    where: {
                        start_date: dateStr,
                        start_time: targetTimeStr
                    }
                },
                {
                    model: TaskAssign,
                    include: [{ model: User, attributes: ['user_id', 'role'] }]
                }
            ]
        });

        for (const task of tasksStartingSoon) {
            // Filter only student assignments
            const studentAssigns = task.TaskAssigns.filter(a => a.User && a.User.role && a.User.role.toLowerCase() === 'student');
            
            if (studentAssigns.length > 0) {
                const totalStudents = studentAssigns.length;
                const acceptedCount = studentAssigns.filter(a => a.status === 'accepted').length;
                const pendingCount = studentAssigns.filter(a => a.status === 'pending').length;
                const rejectedCount = studentAssigns.filter(a => a.status === 'rejected').length;

                let msg = `Assignee Status Update for "${task.title}" (Starts in 2 Hours):\n`;
                msg += `- Total Students: ${totalStudents}\n`;
                msg += `- Accepted: ${acceptedCount}\n`;
                msg += `- Pending: ${pendingCount}\n`;
                msg += `- Rejected: ${rejectedCount}`;

                await sendNotification(task.creator_id, "Pre-Task Assignee Status", msg);
                if (task.is_faculty && task.faculty_id) {
                    await sendNotification(task.faculty_id, "Pre-Task Assignee Status", msg);
                }
            }
        }
    } catch (error) {
        console.error("PRE-TASK STUDENT STATUS CRON ERROR:", error);
    }
};

module.exports = {
    runStart10MinReminderJob,
    runOtpProgressSummaryJob,
    runDocumentSummaryJob,
    runPreTaskStudentStatusJob
};
