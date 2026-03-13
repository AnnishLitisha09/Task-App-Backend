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

// Multer configuration for Excel upload
const upload = multer({ dest: 'uploads/' });
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
router.get('/venue/:id/details', verifyToken, venueController.getVenueDetails);     // Single venue deep-dive
router.get('/calendar', verifyToken, calendarController.getUserCalendar);
router.get('/calendar/venue', verifyToken, calendarController.getVenueCalendar); // NEW: Venue Calendar

// Task Creation
router.post('/unified-create', verifyToken, upload.single('file'), taskController.createUnifiedTask);
router.put('/:id', verifyToken, taskController.updateTask);
router.delete('/:id', verifyToken, taskController.deleteTask);
router.delete('/assignment/:id', verifyToken, taskController.deleteAssignment);


// Task Assignment
router.post('/:id/assign/bulk', verifyToken, upload.single('file'), taskAssignment.bulkAssignByExcel);
router.put('/assignments/:id/status', verifyToken, taskAssignment.adminUpdateStatus);
router.post('/:id/self-assign', verifyToken, taskAssignment.selfAssignTask);
router.post('/:id/notify-pending', verifyToken, taskController.notifyPendingAssignees);

// Task Acceptance/Rejection
router.post('/:id/accept', verifyToken, taskAcceptance.acceptTask);
router.post('/:id/reject', verifyToken, taskAcceptance.rejectTask);
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
router.post('/acknowledge', verifyToken, taskAcknowledgment.acknowledgeTodaysTasks);
router.post('/acknowledge-general', verifyToken, taskAcknowledgment.acknowledgeGeneral);
router.get('/acknowledgments', verifyToken, taskAcknowledgment.getAcknowledgmentHistory);
router.get('/acknowledgments/unacknowledged-report', verifyToken, taskAcknowledgment.getUnacknowledgedUsersReport); // Admin report

// Fetch APIs
router.get('/', verifyToken, taskController.getAllTasks);
router.get('/stats/me', verifyToken, taskController.getUserTaskStats);
router.get('/created-by/:userId', verifyToken, taskController.getTasksCreatedByUser);
router.get('/assigned-to/:userId', verifyToken, taskController.getTasksAssignedToUser);
router.get('/pending-upcoming', verifyToken, taskController.getPendingUpcomingTasks);
router.get('/pending-proof', verifyToken, taskController.getPendingProofTasks); // NEW: Pending Proof
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
router.post('/:id/submit-proof', verifyToken, taskController.submitTaskProof);
router.post('/otp/generate', verifyToken, taskOTPController.generateOTP);
router.get('/otp/active', verifyToken, taskOTPController.getGeneratedOTPs);
router.post('/otp/verify', verifyToken, taskOTPController.verifyOTP);
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

// Pause & Resume
router.put('/:id/pause', verifyToken, taskController.pauseTask);
router.put('/:id/resume', verifyToken, taskController.resumeTask);

router.get('/:id', verifyToken, taskController.getTaskDetail);
router.get('/:id/analysis', verifyToken, taskController.getTaskAnalysis); // NEW: Task Lifecycle Logs
// Put parameterized routes last

module.exports = router;
