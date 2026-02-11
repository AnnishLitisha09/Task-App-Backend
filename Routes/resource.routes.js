const express = require('express');
const router = express.Router();
const resourceController = require('../controllers/resource.controller');
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

router.get('/departments', resourceController.getAllDepartments);
router.get('/departments/:id/analytics', resourceController.getDepartmentAnalytics);
router.post('/departments', isAdmin, resourceController.addDepartment);
router.put('/departments/:id', isAdmin, resourceController.updateDepartment);
router.delete('/departments/:id', isAdmin, resourceController.deleteDepartment);

// HODs
router.get('/hods/unassigned', resourceController.getUnassignedHODs);

// Venues
router.get('/venues', resourceController.getAllVenues);
router.post('/venues', isAdmin, upload.single('image'), resourceController.addVenue);
router.put('/venues/:id', isAdmin, upload.single('image'), resourceController.updateVenue);
router.delete('/venues/:id', isAdmin, resourceController.deleteVenue);
router.get('/venue/:venueId/incharge', resourceController.getVenueIncharge);
router.put('/venues/:id/incharge', isAdmin, resourceController.assignVenueIncharge);

// Resources
router.get('/', resourceController.getAllResources);
router.post('/', isAdmin, resourceController.addResource);
router.put('/:id', isAdmin, resourceController.updateResource);
router.delete('/:id', isAdmin, resourceController.deleteResource);

module.exports = router;
