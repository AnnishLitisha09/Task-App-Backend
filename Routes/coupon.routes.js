const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { verifyToken, isAdmin } = require('../middlewares/auth.middleware');

router.use(verifyToken);

// Coupon CRUD (Admin only)
router.get('/', couponController.getAllCoupons);
router.post('/', isAdmin, couponController.createCoupon);
router.put('/:id', isAdmin, couponController.updateCoupon);
router.delete('/:id', isAdmin, couponController.deleteCoupon);

// Redemption
router.post('/redeem', couponController.redeemCoupon);
router.get('/redeemed', couponController.getUserRedeemedCoupons);
router.get('/redeemed/:userId', isAdmin, couponController.getRedeemedCouponsByUserId);
router.get('/:couponId/users', isAdmin, couponController.getUsersByRedeemedCoupon);

module.exports = router;
