const express = require('express');
const router = express.Router();
const resourceController = require('../controllers/resource.controller');
const maintenanceController = require('../controllers/maintenance.controller');
const { verifyToken, isAdmin } = require('../middlewares/auth.middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer for Venue Images
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/venues';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'venue-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed'));
        }
    }
});

// Public or Authenticated? Assuming Authenticated for now.
router.use(verifyToken);

// Maintenance Logs
router.post('/maintenance/logs', maintenanceController.addMaintenanceLog);
router.put('/maintenance/logs/:id', maintenanceController.updateMaintenanceLog);
router.delete('/maintenance/logs/:id', maintenanceController.deleteMaintenanceLog);
router.get('/maintenance/logs', maintenanceController.getMaintenanceLogs);

// Resource Usage (QR + OTP)
router.post('/usage/start', maintenanceController.startResourceUsage);
router.post('/usage/verify-start', maintenanceController.verifyStartOtp);
router.post('/usage/end', maintenanceController.endResourceUsage);
router.post('/usage/verify-end', maintenanceController.verifyEndOtp);
router.get('/usage/logs', maintenanceController.getUsageLogs);

// Departments
router.get('/departments', resourceController.getAllDepartments);
router.get('/departments/:id/analytics', resourceController.getDepartmentAnalytics);
router.post('/departments', isAdmin, resourceController.addDepartment);
router.put('/departments/:id', isAdmin, resourceController.updateDepartment);
router.delete('/departments/:id', isAdmin, resourceController.deleteDepartment);

// HODs
router.get('/hods/unassigned', resourceController.getUnassignedHODs);

// Venues
router.get('/venues', resourceController.getAllVenues);
router.get('/venue/my-venue', resourceController.getMyVenue); // NEW
router.post('/venues', isAdmin, upload.single('image'), resourceController.addVenue);
router.put('/venues/:id', isAdmin, upload.single('image'), resourceController.updateVenue);
router.delete('/venues/:id', isAdmin, resourceController.deleteVenue);
router.get('/venue/:venueId/incharge', resourceController.getVenueIncharge);
router.put('/venues/:id/incharge', isAdmin, resourceController.assignVenueIncharge);
router.get('/venues/:id/extended-details', maintenanceController.getVenueExtendedDetails);
router.get('/venues/:id/history', maintenanceController.getVenueStatusHistory);
router.get('/venues/:id/resource-analytics', maintenanceController.getVenueResourceAnalytics);
router.get('/venues/:venueId/maintenance-logs', maintenanceController.getMaintenanceLogsByVenue); // NEW

const memoryUpload = multer({ storage: multer.memoryStorage() });

// Resources
router.get('/master', resourceController.getMasterResources); // Master list
router.get('/venue/:id', resourceController.getResourcesByVenue); // Specific venue resources
router.post('/', isAdmin, resourceController.addResource); // Add to master (Admin Only)
router.put('/:id', isAdmin, resourceController.updateResource); // Update master (Admin Only)
router.delete('/:id', isAdmin, resourceController.deleteResource); // Delete master (Admin Only)
router.post('/assign', resourceController.assignResourceToVenue); // Allocation logic
router.post('/remove-assignment', resourceController.removeResourceFromVenue); // De-allocation logic

// Bulk Uploads
router.post('/bulk', isAdmin, memoryUpload.single('file'), resourceController.bulkCreateResources);
router.post('/venues/bulk', isAdmin, memoryUpload.single('file'), resourceController.bulkCreateVenues);

module.exports = router;
