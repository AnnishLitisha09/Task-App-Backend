const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifyToken } = require('../middlewares/auth.middleware');
const taskController = require('../controllers/task.controller');
const taskAssignment = require('../controllers/task.assignment');
const taskClosure = require('../controllers/task.closure');
const taskAcceptance = require('../controllers/task.acceptance');
const taskAcknowledgment = require('../controllers/task.acknowledgment');
const calendarController = require('../controllers/calendar.controller');
const taskOTPController = require('../controllers/task.otp.controller');
const taskLongFloating = require('../controllers/task.long_floating');

const fs = require('fs');
const path = require('path');

// Multer configuration for Excel upload
const upload = multer({ dest: 'uploads/' });

// Specialized Multer for Task Submissions (Preserves extensions)
const submissionStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/submissions';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'sub-' + uniqueSuffix + ext);
    }
});
const submissionUpload = multer({ 
    storage: submissionStorage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});
// Task Title Master
const taskTitleController = require('../controllers/task.title');
router.get('/titles', verifyToken, taskTitleController.getAllTaskTitles);
router.post('/titles', verifyToken, taskTitleController.createTaskTitle);
router.post('/titles/bulk', verifyToken, upload.single('file'), taskTitleController.bulkUploadTaskTitles);
router.put('/titles/:id', verifyToken, taskTitleController.updateTaskTitle);
router.delete('/titles/:id', verifyToken, taskTitleController.deleteTaskTitle);

// Venue Dashboard & Calendar
const venueController = require('../controllers/venue.controller');
router.get('/venue-dashboard', verifyToken, venueController.getVenueDashboard);
router.get('/venue-history', verifyToken, venueController.getVenueHistory);
router.get('/venue-details', verifyToken, venueController.getManagedVenuesDetails); // Detailed all-in-one
router.get('/venues/my-list', verifyToken, venueController.getMyVenuesList);        // Simplified list
router.get('/venues/all', verifyToken, venueController.getAllVenues);            // NEW: All Venues
router.get('/venue/:id/details', verifyToken, venueController.getVenueDetails);     // Single venue deep-dive
router.get('/venue/:id/basic', verifyToken, venueController.getVenueBasicDetails);   // NEW: Basic details
router.get('/calendar', verifyToken, calendarController.getUserCalendar);
router.get('/calendar/venue', verifyToken, calendarController.getVenueCalendar); // NEW: Venue Calendar
router.put('/venue/:id/status', verifyToken, venueController.updateVenueStatus); // NEW: Update Venue Status

// ─── Long Task Actions (No OTP — Proof Required for Completion) ──────────────
// IMPORTANT: Must be before any /:id/* routes or Express will match /long/start as /:id/start
router.post('/long/start',    verifyToken, taskLongFloating.startLongTask);
router.post('/long/pause',    verifyToken, taskLongFloating.pauseLongTask);
router.post('/long/resume',   verifyToken, taskLongFloating.resumeLongTask);
router.post('/long/complete', verifyToken, submissionUpload.single('file'), taskLongFloating.completeLongTask);
router.get('/long/:assignment_id/sessions', verifyToken, taskLongFloating.getLongTaskSessions);

// ─── Floating Task Actions ────────────────────────────────────────────────────
router.post('/floating/complete', verifyToken, submissionUpload.single('file'), taskLongFloating.completeFloatingTask);

// Task Creation
router.post('/unified-create', verifyToken, upload.single('file'), taskController.createUnifiedTask);
router.put('/:id', verifyToken, taskController.updateTask);
router.put('/:id/approve', verifyToken, taskController.approveTask);
router.put('/:id/reject-approval', verifyToken, taskController.rejectTaskApproval);
router.delete('/:id', verifyToken, taskController.deleteTask);
router.delete('/assignment/:id', verifyToken, taskController.deleteAssignment);
router.put('/:id/reschedule', verifyToken, taskController.rescheduleTask); // NEW

// Task Assignment
router.post('/:id/assign/bulk', verifyToken, upload.single('file'), taskAssignment.bulkAssignByExcel);
router.put('/assignments/:id/status', verifyToken, taskAssignment.adminUpdateStatus);
router.post('/:id/self-assign', verifyToken, taskAssignment.selfAssignTask);
router.post('/:id/notify-pending', verifyToken, taskController.notifyPendingAssignees);

// Task Acceptance/Rejection
router.post('/:id/accept', verifyToken, taskAcceptance.acceptTask);
router.post('/:id/reject', verifyToken, taskAcceptance.rejectTask);
router.put('/:id/reject',  verifyToken, taskAcceptance.rejectTask); // ADDED: Match frontend PUT expectation
router.post('/:id/transfer', verifyToken, taskAcceptance.transferTask);
router.post('/:id/cancel-approval', verifyToken, taskAcceptance.cancelApproval);
router.post('/:id/resolve-swap', verifyToken, taskAcceptance.resolveConflictWithSwap);
router.put('/escalations/:id/read', verifyToken, taskAcceptance.updateEscalationReadStatus);

// Approval Gate Routes
router.get('/approval-requests/pending', verifyToken, taskAcceptance.getPendingApprovalRequests);
router.post('/approval-requests/:requestId/approve', verifyToken, taskAcceptance.approveRequest);
router.post('/approval-requests/:requestId/reject', verifyToken, taskAcceptance.rejectRequest);

// Task Acknowledgment
router.get('/today/unacknowledged', verifyToken, taskAcknowledgment.getTodaysUnacknowledgedTasks);
router.get('/acknowledgments/status', verifyToken, taskAcknowledgment.getGeneralAcknowledgmentStatus);
router.post('/acknowledge', verifyToken, taskAcknowledgment.acknowledgeTodaysTasks);
router.post('/acknowledge-general', verifyToken, taskAcknowledgment.acknowledgeGeneral);
router.get('/acknowledgments/history', verifyToken, taskAcknowledgment.getAcknowledgmentHistory);
router.get('/acknowledgments/unacknowledged-report', verifyToken, taskAcknowledgment.getUnacknowledgedUsersReport); // Admin report
router.get('/:id/acknowledgments', verifyToken, taskAcknowledgment.getTaskAcknowledgments);

// Fetch APIs
router.get('/', verifyToken, taskController.getAllTasks);
router.get('/:id/details', verifyToken, taskController.getTaskDetailsById); // NEW Task Details Endpoint
router.get('/stats/me', verifyToken, taskController.getUserTaskStats);
router.get('/created-by/:userId', verifyToken, taskController.getTasksCreatedByUser);
router.get('/assigned-to/:userId', verifyToken, taskController.getTasksAssignedToUser);
router.get('/pending-upcoming', verifyToken, taskController.getPendingUpcomingTasks);
router.get('/today', verifyToken, taskController.getTodaysTasksForUser); // NEW: Today's Tasks

router.get('/pending-proof', verifyToken, taskController.getPendingProofTasks); // NEW: Pending Proof
router.get('/verification/pending', verifyToken, taskController.getVerificationTasks); // NEW: Tasks awaiting review
router.get('/assigned-today', verifyToken, taskController.getTasksAssignedToday); // NEW: Assigned Today
router.get('/assigned-today/:userId', verifyToken, taskController.getTasksAssignedTodayByUserId); // NEW: Assigned Today for user

router.get('/approved-upcoming', verifyToken, taskController.getApprovedUpcomingTasks); // NEW: Approved Upcoming
router.get('/unapproved-tasks', verifyToken, taskController.getUnapprovedTasks); // NEW: Unapproved (Pending + Past/Current Start)
router.get('/daily', verifyToken, taskController.getDailyTasks); // NEW: Grouped Daily Tasks
router.get('/daily-report', verifyToken, taskController.getDailyTaskReport); // NEW: Specialized Daily Report
router.get('/schedule/monthly', verifyToken, taskController.getMonthlySchedule); // NEW: Monthly Schedule
router.get('/schedule/today', verifyToken, taskController.getTodaysApprovedSchedule); // NEW: Today's Approved Schedule

// Task Detail (Comprehensive)
router.get('/:id/detail', verifyToken, taskController.getTaskDetail); // NEW: Get all task details
router.get('/:id/exhaustive', verifyToken, taskController.getExhaustiveTaskDetails); // NEW: Exhaustive details with logs/history

// Task Completion & Proof
router.post('/:id/submit-proof', verifyToken, submissionUpload.single('file'), taskController.submitTaskProof);
router.post('/:id/assignment/:assignmentId/verify-proof', verifyToken, taskController.verifyTaskProof);
router.post('/assignment/:id/review-proof', verifyToken, taskController.reviewTaskProof);
router.post('/otp/generate', verifyToken, taskOTPController.generateOTP);
router.get('/otp/active', verifyToken, taskOTPController.getGeneratedOTPs);
router.post('/otp/verify', verifyToken, upload.single('file'), taskOTPController.verifyOTP);
router.post('/:id/start-activity', verifyToken, taskController.startActivity);
router.get('/otp/creator/assignments', verifyToken, taskOTPController.getCreatorTaskAssignments);

// Task Closure
router.get('/closure-types', verifyToken, taskClosure.getClosureTypes);
router.post('/:id/start', verifyToken, taskClosure.startTask);
router.post('/:id/close', verifyToken, taskClosure.closeTask);

// Escalation Support
router.get('/escalations/me', verifyToken, taskController.getMyEscalations); // NEW: Fetch my escalations
router.get('/escalated/creator', verifyToken, taskController.getEscalatedTasksForCreator);
router.get('/rejections/me', verifyToken, taskController.getRejectionEscalationsForCreator);
router.post('/:id/escalate', verifyToken, taskController.manualEscalateTask);
router.get('/:id/escalation-report', verifyToken, taskController.getTaskEscalationReport);

// Pause & Resume (Generic — kept for compatibility)
router.put('/:id/pause', verifyToken, taskController.pauseTask);
router.put('/:id/resume', verifyToken, taskController.resumeTask);

router.get('/analytics/title-wise', verifyToken, taskController.getTitleWiseTaskStats); // NEW: Title-wise tracking analytics

router.get('/:id', verifyToken, taskController.getTaskDetail);
router.get('/:id/analysis', verifyToken, taskController.getTaskAnalysis); // NEW: Task Lifecycle Logs
router.get('/:id/status', verifyToken, taskController.getTaskStatusSummary); // NEW: Task Status Summary
// Put parameterized routes last

module.exports = router;
