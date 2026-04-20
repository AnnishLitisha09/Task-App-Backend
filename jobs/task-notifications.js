const { Task, TaskType, TaskAssign, TaskOTP, User, Notification, TaskPackageClosure, TaskClosure } = require('../models');
const { Op, literal } = require('sequelize');
const { sendPushNotification } = require('../utils/onesignal');

let isProcessingStartReminder = false;
let isProcessingOtpSummary = false;
let isProcessingDocSummary = false;
let isProcessingStudentStatus = false;

const { sendToUser } = require('../utils/socket-utils');

/**
 * Helper to create a notification (DB + Socket + Push)
 */
const sendNotification = async (userId, title, msg, type = 'general') => {
    if (!userId) return;
    try {
        // 1. Save to Database for internal Notification Center
        const createdNotif = await Notification.create({
            user_id: userId,
            title,
            msg,
            type
        });

        // 2. Real-time Socket Alert (for active users)
        sendToUser(userId, 'notification', {
            id: createdNotif.id,
            title,
            msg,
            type,
            created_at: createdNotif.created_at
        });

        // 3. Trigger Real Push Notification (as backup)
        // await sendPushNotification(userId, title, msg, { type });

    } catch (error) {
        console.error(`[NOTIFICATION] Failed to send to ${userId}:`, error.message);
    }
};

/**
 * Pre-Task Notification: Notify creator/faculty 10 minutes before a task starts.
 * This runs every minute.
 */
const runStart10MinReminderJob = async () => {
    if (isProcessingStartReminder) return;
    isProcessingStartReminder = true;
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
            const { createNotification } = require('../utils/task-utils');
            
            await createNotification({
                userId: task.creator_id,
                title: "Task Starting Soon",
                msg,
                type: 'reminders',
                venueId: task.venue_id
            });

            if (task.is_faculty && task.faculty_id) {
                await createNotification({
                    userId: task.faculty_id,
                    title: "Task Starting Soon",
                    msg,
                    type: 'reminders',
                    venueId: task.venue_id
                });
            }
        }
    } finally {
        isProcessingStartReminder = false;
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
    if (isProcessingOtpSummary) return;
    isProcessingOtpSummary = true;
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

        const { createNotification } = require('../utils/task-utils');
        for (const task of tasks15MinAfterStart) {
            // Count total assignees vs how many used the START OTP
            const totalAssignees = task.TaskAssigns.length;
            const completedStart = task.TaskAssigns.filter(a => a.TaskOTPs && a.TaskOTPs.length > 0).length;

            const msg = `Update for "${task.title}": ${completedStart} out of ${totalAssignees} students have entered the START OTP.`;
            await createNotification({
                userId: task.creator_id,
                title: "START OTP Progress",
                msg,
                type: 'summary',
                venueId: task.venue_id
            });
            if (task.is_faculty && task.faculty_id) {
                await createNotification({
                    userId: task.faculty_id,
                    title: "START OTP Progress",
                    msg,
                    type: 'summary',
                    venueId: task.venue_id
                });
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
            await createNotification({
                userId: task.creator_id,
                title: "END OTP Progress",
                msg,
                type: 'summary',
                venueId: task.venue_id
            });
            if (task.is_faculty && task.faculty_id) {
                await createNotification({
                    userId: task.faculty_id,
                    title: "END OTP Progress",
                    msg,
                    type: 'summary',
                    venueId: task.venue_id
                });
            }
        }
    } finally {
        isProcessingOtpSummary = false;
    }
};

/**
 * Document Summary: End-of-Day Document Summary (e.g. at 9:00 PM).
 * Scans tasks that ended today and required document closure.
 * Compiles a list: submitted document, only submitted OTP, missed entirely.
 */
const runDocumentSummaryJob = async () => {
    if (isProcessingDocSummary) return;
    isProcessingDocSummary = true;
    try {
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;

        // Find tasks ending today with is_document = true OR with a document closure via TaskPackageClosure
        const completedDocsTasks = await Task.findAll({
            where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
            include: [
                {
                    model: TaskType,
                    required: true,
                    where: { end_date: dateStr }
                }, 
                {
                    model: TaskAssign,
                    include: [
                        { model: User, attributes: ['user_id', 'role'], include: [require('../models').Student] },
                        { model: TaskOTP, required: false }
                    ]
                },
                {
                    model: TaskPackageClosure,
                    required: false,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                }
            ]
        });

        const { createNotification } = require('../utils/task-utils');
        for (const task of completedDocsTasks) {
            // Check if document was required:
            // Either task.is_document is true, OR there are closures indicating 'document' or 'image'
            const isDocsReq = task.is_document === true; 
            if (!isDocsReq) {
                // Check task closures from eager-loaded data
                const closures = task.TaskPackageClosures || [];
                const needsDocs = closures.some(c => ['document', 'image'].includes(c.TaskClosure?.name));
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

            await createNotification({
                userId: task.creator_id,
                title: "End-Of-Day Documentation Summary",
                msg,
                type: 'summary',
                venueId: task.venue_id
            });
            if (task.is_faculty && task.faculty_id) {
                await createNotification({
                    userId: task.faculty_id,
                    title: "End-Of-Day Documentation Summary",
                    msg,
                    type: 'summary',
                    venueId: task.venue_id
                });
            }
        }
    } finally {
        isProcessingDocSummary = false;
    }
};

/**
 * Pre-Task Creator Summary Notification: Notify creator 2 hours before a task starts
 * about the overall status of all assignees (Accepted, Rejected, Pending, Escalated).
 * Runs every minute.
 */
const runPreTaskCreatorSummaryJob = async () => {
    if (isProcessingStudentStatus) return;
    isProcessingStudentStatus = true;
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

        const { createNotification } = require('../utils/task-utils');

        // Grouping logic to fix "10 unread messages"
        const creatorSummaries = {}; // { userId: [msg1, msg2, ...] }
        const facultySummaries = {};

        for (const task of tasksStartingSoon) {
            const allAssigns = task.TaskAssigns || [];
            if (allAssigns.length === 0) continue;

            const totalAssignees = allAssigns.length;
            const acceptedCount = allAssigns.filter(a => a.status === 'accepted').length;
            const pendingCount = allAssigns.filter(a => a.status === 'pending').length;
            const rejectedCount = allAssigns.filter(a => a.status === 'rejected').length;
            const escalatedCount = allAssigns.filter(a => a.status === 'escalated').length;

            let taskSummary = `Task: "${task.title}"\n`;
            taskSummary += `Accepted: ${acceptedCount}/${totalAssignees}`;
            if (pendingCount > 0) taskSummary += `, Pending: ${pendingCount}`;
            if (rejectedCount > 0) taskSummary += `, Rejected: ${rejectedCount}`;
            
            if (!creatorSummaries[task.creator_id]) creatorSummaries[task.creator_id] = [];
            creatorSummaries[task.creator_id].push(taskSummary);

            if (task.is_faculty && task.faculty_id) {
                if (!facultySummaries[task.faculty_id]) facultySummaries[task.faculty_id] = [];
                facultySummaries[task.faculty_id].push(taskSummary);
            }
        }

        // Send grouped summaries
        for (const [uid, summaries] of Object.entries(creatorSummaries)) {
            const msg = `Status Summary for ${summaries.length} tasks starting in 2 hours:\n\n` + summaries.join('\n\n');
            await createNotification({ userId: uid, title: "Upcoming Tasks Summary", msg, type: 'summary' });
        }
        for (const [uid, summaries] of Object.entries(facultySummaries)) {
            const msg = `Status Summary (Faculty) for ${summaries.length} tasks starting in 2 hours:\n\n` + summaries.join('\n\n');
            await createNotification({ userId: uid, title: "Upcoming Tasks Summary", msg, type: 'summary' });
        }
    } finally {
        isProcessingStudentStatus = false;
    }
};

/**
 * Venue Incharge Escalation & Reminders
 * 1. If a Venue Task is pending for > 2 hours, remind the incharge.
 * 2. If a Venue Task is pending for > 24 hours, notify the creator.
 */
let isProcessingVenueEscalation = false;
const runVenueEscalationJob = async () => {
    if (isProcessingVenueEscalation) return;
    isProcessingVenueEscalation = true;
    try {
        const { Task, TaskAssign, User, RoleAssignment, Role } = require('../models');
        const { createNotification } = require('../utils/task-utils');

        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Find pending venue assignments
        const pendingVenueAssigns = await TaskAssign.findAll({
            where: { 
                status: 'pending',
                created_at: { [Op.lt]: twoHoursAgo }
            },
            include: [{
                model: Task,
                where: { venue_id: { [Op.ne]: null }, is_deleted: false },
                include: [require('../models').TaskType]
            }, {
                model: User
            }]
        });

        for (const assign of pendingVenueAssigns) {
            const task = assign.Task;
            const createdTime = new Date(assign.created_at);

            // 1. Reminder to Incharge (2 - 24 hours)
            if (createdTime < twoHoursAgo && createdTime >= twentyFourHoursAgo) {
                await createNotification({
                    userId: assign.user_id,
                    title: "URGENT: Pending Venue Booking",
                    msg: `You have a pending venue booking request for "${task.title}". Please accept or reject it soon.`,
                    type: 'reminders',
                    venueId: task.venue_id
                });
            }

            // 2. Alert to Creator (> 24 hours)
            if (createdTime < twentyFourHoursAgo) {
                await createNotification({
                    userId: task.creator_id,
                    title: "Escalation: Venue Incharge Inactive",
                    msg: `The venue booking for "${task.title}" has been pending for over 24 hours. The Incharge (ID: ${assign.user_id}) hasn't responded.`,
                    type: 'task_escalation',
                    venueId: task.venue_id
                });
            }
        }
    } catch (error) {
        console.error("[Venue Escalation Job Error]:", error);
    } finally {
        isProcessingVenueEscalation = false;
    }
};

module.exports = {
    runStart10MinReminderJob,
    runOtpProgressSummaryJob,
    runDocumentSummaryJob,
    runPreTaskCreatorSummaryJob,
    runVenueEscalationJob
};
