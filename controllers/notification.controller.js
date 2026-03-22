const { Notification } = require('../models');


// Fetch user notifications
exports.getNotifications = async (req, res) => {
    try {
        const userId = req.userId;
        const { venue_id } = req.query;
        const { Op } = require('sequelize');

        const where = { user_id: userId };

        if (venue_id) {
            // Fetch notifications for a specific venue
            where.title = { [Op.like]: `[V:${venue_id}]%` };
        } else {
            // Fetch only personal notifications (those NOT starting with a venue prefix)
            where.title = { [Op.notLike]: '[V:%]' };
        }

        const notifications = await Notification.findAll({
            where,
            order: [['created_at', 'DESC']]
        });

        // Optional: Strip the prefix [V:ID] before sending to frontend if preferred, 
        // but here we send as-is and let the frontend handle the display.
        res.json({ total: notifications.length, notifications });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const notification = await Notification.findOne({
            where: { notification_id: id, user_id: userId }
        });

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        await notification.update({ is_read: true });
        res.json({ message: 'Notification marked as read' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        const notification = await Notification.findOne({
            where: { notification_id: id, user_id: userId }
        });

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        await notification.destroy();
        res.json({ message: 'Notification deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
