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
            totalItems: coupons.length,
            items: coupons,
            totalPages: 1,
            currentPage: 1,
            limit: coupons.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
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
        const redemptions = await Redeem.findAll({
            where: { user_id: userId },
            include: [{ model: Coupon }],
            order: [['id', 'DESC']]
        });
        res.json({
            totalItems: redemptions.length,
            items: redemptions,
            totalPages: 1,
            currentPage: 1,
            limit: redemptions.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getRedeemedCouponsByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const redemptions = await Redeem.findAll({
            where: { user_id: userId },
            include: [{ model: Coupon }],
            order: [['id', 'DESC']]
        });
        res.json({
            totalItems: redemptions.length,
            items: redemptions,
            totalPages: 1,
            currentPage: 1,
            limit: redemptions.length || 10
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
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
