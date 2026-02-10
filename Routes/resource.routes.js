const express = require('express');
const router = express.Router();
const resourceController = require('../controllers/resource.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Public or Authenticated? Assuming Authenticated for now.
router.use(verifyToken);

router.get('/departments', resourceController.getAllDepartments);
router.get('/venues', resourceController.getAllVenues);
router.get('/venue/:venueId/incharge', resourceController.getVenueIncharge);

module.exports = router;
