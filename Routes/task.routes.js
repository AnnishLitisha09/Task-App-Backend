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

// Multer configuration for Excel upload
const upload = multer({ dest: 'uploads/' });

// Calendar
router.get('/calendar', verifyToken, calendarController.getUserCalendar);

// Task Creation
router.post('/unified-create', verifyToken, upload.single('file'), taskController.createUnifiedTask);
router.put('/:id', verifyToken, taskController.updateTask);
router.delete('/:id', verifyToken, taskController.deleteTask);

// Task Assignment
router.post('/:id/assign/bulk', verifyToken, upload.single('file'), taskAssignment.bulkAssignByExcel);

// Task Acceptance/Rejection
router.post('/:id/accept', verifyToken, taskAcceptance.acceptTask);
router.post('/:id/reject', verifyToken, taskAcceptance.rejectTask);

// Task Acknowledgment
router.get('/today/unacknowledged', verifyToken, taskAcknowledgment.getTodaysUnacknowledgedTasks);
router.post('/acknowledge', verifyToken, taskAcknowledgment.acknowledgeTodaysTasks);
router.get('/acknowledgments', verifyToken, taskAcknowledgment.getAcknowledgmentHistory);

// Fetch APIs
router.get('/', verifyToken, taskController.getAllTasks);
router.get('/created-by/:userId', verifyToken, taskController.getTasksCreatedByUser);
router.get('/assigned-to/:userId', verifyToken, taskController.getTasksAssignedToUser);
// Task Completion & Proof
router.post('/:id/submit-proof', verifyToken, taskController.submitTaskProof);

// Escalation Support
router.get('/escalated/creator', verifyToken, taskController.getEscalatedTasksForCreator);
router.post('/:id/escalate', verifyToken, taskController.manualEscalateTask);
router.get('/:id/escalation-report', verifyToken, taskController.getTaskEscalationReport);

router.get('/:id', verifyToken, taskController.getTaskById); // Put parameterized routes last

module.exports = router;
