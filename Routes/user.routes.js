const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const userDashboard = require('../controllers/user.dashboard');
const { verifyToken, isAdmin } = require('../middlewares/auth.middleware');
const multer = require('multer');

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Public Test Route
router.post('/test-notification', userController.testNotification);

// Apply verifyToken to all routes (Authentication required)
router.use(verifyToken);

// ==========================================
// Public/Authenticated User Routes (No Admin Required)
// ==========================================

// Get User Profile
router.get('/profile', userController.getProfile); // Profile from token
router.post('/fcm-token', userController.saveFcmToken);
router.get('/me', userController.getProfile);      // Alias for profile from token
router.get('/:id/details', userController.getUserDetails); // Admin viewing specific user
router.get('/:id/activity', userController.getUserActivity); // NEW: Unified Profile + Daily Tasks
router.get('/dashboard/Departmental', userDashboard.getHodDashboard); // Renamed from /dashboard/hod
router.get('/dashboard/departmental-tasks', userDashboard.getDepartmentalTasks); // NEW: Paginated departmental tasks
router.get('/dashboard/staff', userDashboard.getStaffDashboard); // NEW: Staff Dashboard
router.get('/dashboard/activity-history', userDashboard.getActivityHistory); // NEW: Activity History (Today/Yesterday)
router.get('/dashboard/hod/department-users', userDashboard.getDepartmentUsers);
router.get('/dashboard/Institutional', userDashboard.getPrincipalDashboard); // Renamed from /dashboard/principal
router.get('/dashboard/student', userDashboard.getStudentDashboard); // NEW: Student Dashboard


// Fetch Lists (Accessible to authenticated users)
router.get('/students/:deptId', userController.getStudentsByDepartment);
router.get('/faculty/students', userController.getStudentsByFaculty); // Returns paginated students
router.get('/faculty/mentees', userController.getFacultyDetailsWithStudents); // NEW: Faculty details + Students
router.get('/faculty/profile', userController.getFacultyDetailsWithStudents); // Alias for dashboard details
router.get('/faculty/stats/daily', userController.getFacultyDailyStats); // NEW: Daily statistics for faculty
router.get('/faculty/tasks/by-approval', userController.getFacultyTasksByApprovalStatus); // NEW: Filter tasks by approval status
router.get('/faculty/:deptId', userController.getFacultyByDepartment);
router.get('/management-staff', userController.getManagementStaff);
router.get('/hods', userController.getAllHODs);
router.get('/incharges', userController.getAllIncharges);
router.get('/incharge-candidates', userController.getInchargeCandidates);
router.get('/hod-candidates', userController.getHODCandidates);
router.get('/fetch', userController.getUnifiedUsers); // Unified User Fetch
router.get('/fetch/department-wise', userController.getAllUsersByDepartment); // ALIAS for fetch/department-wise
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
router.post('/bulk', upload.single('file'), userController.bulkCreateUsers); // Unified Bulk Upload
router.post('/bulk/students', upload.single('file'), userController.bulkCreateUsers);
router.post('/bulk/faculty', upload.single('file'), userController.bulkCreateUsers);

// User Management Actions
router.delete('/:id', userController.deleteUser);
router.get('/dashboard/all', userDashboard.getAllUsersWithDetails); // Admin dashboard
router.get('/dashboard/stats', userDashboard.getSystemStats);      // System counts
router.get('/dashboard/students/leaderboard', userDashboard.getStudentLeaderboard);
router.get('/dashboard/faculty/leaderboard', userDashboard.getFacultyLeaderboard);
router.post('/assign-role', userController.assignRole);
router.post('/assign-hod', userController.assignHOD);
router.put('/:id/roles', userController.updateUserRoles);
router.put('/students/:id/faculty', userController.updateStudentFaculty);

// Authority Allocation
router.get('/authority/roles', userController.getAvailableRoles);        // Get roles grouped by scope
router.get('/authority/all', userController.getAllAuthorities);           // Get all assignments
router.post('/authority/assign', userController.assignAuthority);        // Assign authority
router.delete('/authority/remove', userController.removeAuthority);      // Remove authority

module.exports = router;
