const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const userDashboard = require('../controllers/user.dashboard');
const { verifyToken, isAdmin } = require('../middlewares/auth.middleware');
const multer = require('multer');

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Apply verifyToken to all routes (Authentication required)
router.use(verifyToken);

// ==========================================
// Public/Authenticated User Routes (No Admin Required)
// ==========================================

// Get User Profile
router.get('/profile', userController.getProfile); // Profile from token
router.get('/me', userController.getProfile);      // Alias for profile from token
router.get('/:id/details', userController.getUserDetails); // Admin viewing specific user
router.get('/:id/activity', userController.getUserActivity); // NEW: Unified Profile + Daily Tasks


// Fetch Lists (Accessible to authenticated users)
router.get('/students/:deptId', userController.getStudentsByDepartment);
router.get('/faculty/students', userController.getStudentsByFaculty); // Added for faculty use
router.get('/faculty/profile', userController.getFacultyDetailsWithStudents); // NEW: Full faculty dashboard details
router.get('/faculty/stats/daily', userController.getFacultyDailyStats); // NEW: Daily statistics for faculty
router.get('/faculty/tasks/by-approval', userController.getFacultyTasksByApprovalStatus); // NEW: Filter tasks by approval status
router.get('/faculty/:deptId', userController.getFacultyByDepartment);
router.get('/management-staff', userController.getManagementStaff);
router.get('/hods', userController.getAllHODs);
router.get('/incharges', userController.getAllIncharges);
router.get('/fetch', userController.getUnifiedUsers); // Unified User Fetch
router.get('/by-department', userController.getAllUsersByDepartment); // NEW: Get all users grouped by department

// ==========================================
// Admin Only Routes
// ==========================================

// Middleware to check Admin role for subsequent routes
router.use(isAdmin);

// Admin-only routes (must come after verifyToken + isAdmin middlewares)
// Single User Creation
router.post('/student', userController.createStudent);
router.post('/faculty', userController.createFaculty);
router.post('/staff', userController.createStaff);
router.post('/role-user', userController.createRoleUser);

// Bulk Creation
router.post('/bulk/students', upload.single('file'), userController.bulkCreateUsers);
router.post('/bulk/faculty', upload.single('file'), userController.bulkCreateUsers);

// User Management Actions
router.delete('/:id', userController.deleteUser);
router.get('/dashboard/all', userDashboard.getAllUsersWithDetails); // Admin dashboard
router.get('/dashboard/stats', userDashboard.getSystemStats);      // System counts
router.get('/dashboard/students/leaderboard', userDashboard.getStudentLeaderboard);
router.get('/dashboard/faculty/leaderboard', userDashboard.getFacultyLeaderboard);
router.post('/assign-role', userController.assignRole);
router.put('/students/:id/faculty', userController.updateStudentFaculty);

module.exports = router;
