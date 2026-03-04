const { Coupon, Redeem, User, Student, Faculty, RoleUser, Staff } = require('../models');


// --- Coupon CRUD ---

exports.createCoupon = async (req, res) => {
    try {
        const { name, validity, total_count, points } = req.body;

        if (!name || !validity || total_count === undefined) {
            return res.status(400).json({ message: 'Name, validity, and total_count are required' });
        }

        const coupon = await Coupon.create({
            name,
            validity,
            total_count,
            remaining_count: total_count,
            points: points || 0,
            status: 'active'
        });

        res.status(201).json({ message: 'Coupon created successfully', coupon });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, validity, total_count, status, points } = req.body;

        const coupon = await Coupon.findByPk(id);
        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        const updateData = { name, validity, status, points };
        if (total_count !== undefined) {
            const diff = total_count - coupon.total_count;
            updateData.total_count = total_count;
            updateData.remaining_count = coupon.remaining_count + diff;

            if (updateData.remaining_count < 0) updateData.remaining_count = 0;
        }

        await coupon.update(updateData);
        res.json({ message: 'Coupon updated successfully', coupon });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findByPk(id);
        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        await coupon.destroy();
        res.json({ message: 'Coupon deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.findAll({ order: [['id', 'DESC']] });
        const activeCount = await Coupon.count({ where: { status: 'active' } });
        const inactiveCount = await Coupon.count({ where: { status: 'inactive' } });
        const totalIssuedCount = await Redeem.count();
        res.json({
            success: true,
            stats: { active_coupons: activeCount, inactive_coupons: inactiveCount, total_issued: totalIssuedCount },
            total: coupons.length,
            items: coupons
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAvailableCoupons = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;
        const { Op } = require('sequelize');

        // 1. Fetch User Score
        let profile = null;
        if (userRole === 'student') {
            profile = await Student.findOne({ where: { user_id: userId } });
        } else if (userRole === 'faculty') {
            profile = await Faculty.findOne({ where: { user_id: userId } });
        } else if (userRole === 'role-user') {
            profile = await RoleUser.findOne({ where: { user_id: userId } });
        }

        const score = profile ? parseFloat(profile.score || 0) : 0;

        // 2. Fetch Already Redeemed Coupon IDs for this user
        const alreadyRedeemed = await Redeem.findAll({
            where: { user_id: userId },
            attributes: ['coupon_id']
        });
        const redeemedIds = alreadyRedeemed.map(r => r.coupon_id);

        // 3. Fetch Available Coupons (active, in stock, not expired, not already redeemed by this user)
        const now = new Date();
        const whereClause = {
            status: 'active',
            remaining_count: { [Op.gt]: 0 },
            validity: { [Op.gte]: now }
        };
        if (redeemedIds.length > 0) {
            whereClause.id = { [Op.notIn]: redeemedIds };
        }

        const coupons = await Coupon.findAll({
            where: whereClause,
            order: [['points', 'ASC']]
        });

        res.json({
            success: true,
            score: score,
            count: coupons.length,
            coupons: coupons
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- Redemption Logic ---

exports.redeemCoupon = async (req, res) => {
    const t = await Coupon.sequelize.transaction();
    try {
        const userId = req.userId;
        const userRole = req.userRole;
        const { coupon_id } = req.body;

        const coupon = await Coupon.findByPk(coupon_id, { transaction: t });
        if (!coupon) {
            await t.rollback();
            return res.status(404).json({ message: 'Coupon not found' });
        }

        if (coupon.status !== 'active' || coupon.remaining_count <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Coupon is not available or out of stock' });
        }

        // Check if user has already redeemed this coupon
        const existingRedeem = await Redeem.findOne({
            where: { user_id: userId, coupon_id },
            transaction: t
        });
        if (existingRedeem) {
            await t.rollback();
            return res.status(400).json({ message: 'You have already redeemed this coupon' });
        }

        // Check validity
        if (new Date(coupon.validity) < new Date()) {
            await t.rollback();
            return res.status(400).json({ message: 'Coupon has expired' });
        }

        // Check user score/points
        let profile = null;
        if (userRole === 'student') {
            profile = await Student.findOne({ where: { user_id: userId }, transaction: t });
        } else if (userRole === 'faculty') {
            profile = await Faculty.findOne({ where: { user_id: userId }, transaction: t });
        } else if (userRole === 'role-user') {
            profile = await RoleUser.findOne({ where: { user_id: userId }, transaction: t });
        }

        if (!profile) {
            await t.rollback();
            return res.status(404).json({ message: 'User profile not found for score check' });
        }

        const userScore = parseFloat(profile.score || 0);
        const couponCost = parseFloat(coupon.points || 0);

        if (userScore < couponCost) {
            await t.rollback();
            return res.status(400).json({ message: `Insufficient score. You need ${couponCost} points, but you have ${userScore}` });
        }

        // Deduct score, decrement count and create redeem record
        await profile.update({ score: userScore - couponCost }, { transaction: t });
        await coupon.update({ remaining_count: coupon.remaining_count - 1 }, { transaction: t });

        const redeem = await Redeem.create({
            user_id: userId,
            coupon_id: coupon.id
        }, { transaction: t });

        await t.commit();
        res.status(201).json({
            message: 'Coupon redeemed successfully',
            redeem,
            deducted_points: couponCost,
            remaining_score: userScore - couponCost
        });
    } catch (error) {
        if (t) await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.getUserRedeemedCoupons = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;

        // 1. Fetch User Scores
        let profile = null;
        if (userRole === 'student') {
            profile = await Student.findOne({ where: { user_id: userId } });
        } else if (userRole === 'faculty') {
            profile = await Faculty.findOne({ where: { user_id: userId } });
        } else if (userRole === 'role-user') {
            profile = await RoleUser.findOne({ where: { user_id: userId } });
        } else if (userRole === 'staff') {
            profile = await Staff.findOne({ where: { user_id: userId } });
        }

        // 2. Fetch Redemptions
        const redemptions = await Redeem.findAll({
            where: { user_id: userId },
            include: [{ model: Coupon }],
            order: [['id', 'DESC']]
        });

        const formatted = redemptions.map(r => ({
            redemption_id: r.id,
            coupon_name: r.Coupon?.name,
            points_deducted: r.Coupon?.points,
            coupon_details: r.Coupon
        }));

        res.json({
            success: true,
            user_scores: {
                current_net_score: profile ? parseFloat(profile.score || 0) : 0,
                cumulative_gross_total: profile ? parseFloat(profile.total_score || 0) : 0,
                total_penalty: profile ? parseFloat(profile.penalty || 0) : 0
            },
            count: formatted.length,
            items: formatted
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

exports.getRedeemedCouponsByUserId = async (req, res) => {
    try {
        const { userId } = req.params;

        // Fetch User (to determine role/profile)
        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        let profile = null;
        if (user.role === 'student') profile = await Student.findOne({ where: { user_id: userId } });
        else if (user.role === 'faculty') profile = await Faculty.findOne({ where: { user_id: userId } });
        else if (user.role === 'staff') profile = await Staff.findOne({ where: { user_id: userId } });
        else if (user.role === 'role-user') profile = await RoleUser.findOne({ where: { user_id: userId } });

        const redemptions = await Redeem.findAll({
            where: { user_id: userId },
            include: [{ model: Coupon }],
            order: [['id', 'DESC']]
        });

        const formatted = redemptions.map(r => ({
            redemption_id: r.id,
            coupon_name: r.Coupon?.name,
            points_deducted: r.Coupon?.points,
            coupon_details: r.Coupon
        }));

        res.json({
            success: true,
            user_details: {
                user_id: userId,
                role: user.role,
                current_net_score: profile ? parseFloat(profile.score || 0) : 0,
                cumulative_gross_total: profile ? parseFloat(profile.total_score || 0) : 0
            },
            count: formatted.length,
            items: formatted
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getUsersByRedeemedCoupon = async (req, res) => {
    try {
        const { couponId } = req.params;
        const redemptions = await Redeem.findAll({
            where: { coupon_id: couponId },
            include: [{
                model: User,
                attributes: ['user_id', 'role'],
                include: [
                    { model: Student, attributes: ['name', 'email'] },
                    { model: Faculty, attributes: ['name', 'email'] },
                    { model: RoleUser, attributes: ['name', 'email'] },
                    { model: Staff, attributes: ['name', 'email'] }
                ]
            }],
            order: [['id', 'DESC']]
        });

        const users = redemptions.map(r => {
            const u = r.User;
            let details = u.Student || u.Faculty || u.RoleUser || u.Staff || null;
            return {
                user_id: u.user_id,
                role: u.role,
                name: details ? details.name : 'Unknown',
                email: details ? details.email : 'Unknown'
            };
        });

        res.json({
            coupon_id: couponId,
            totalItems: users.length,
            items: users,
            totalPages: 1,
            currentPage: 1,
            limit: users.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
