const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leave.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.use(verifyToken);

// Student Leave Routes
router.post('/apply', leaveController.applyLeave);
router.delete('/:id', leaveController.deleteLeave);
router.get('/my-leaves', leaveController.getStudentLeaves);

// Faculty Leave Routes
router.get('/faculty/pending', leaveController.getFacultyPendingApprovals);
router.put('/:id/status', leaveController.approveOrRejectLeave);

module.exports = router;
