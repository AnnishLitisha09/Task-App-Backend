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
router.get('/:id/details', userController.getUserDetails); // Admin viewing specific user


// Fetch Lists (Accessible to authenticated users)
router.get('/students/:deptId', userController.getStudentsByDepartment);
router.get('/faculty/:deptId', userController.getFacultyByDepartment);

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
router.post('/assign-role', userController.assignRole);

module.exports = router;
