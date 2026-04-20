const { Notification } = require('../models');

// Helper: Convert UTC Date to IST ISO string (e.g. "2026-04-18T15:00:43+05:30")
const toISTString = (utcDate) => {
    if (!utcDate) return null;
    const d = new Date(utcDate);
    // IST = UTC + 5:30
    const istOffset = 5 * 60 + 30; // minutes
    const istMs = d.getTime() + istOffset * 60 * 1000;
    const istDate = new Date(istMs);
    // Build ISO string with +05:30 suffix
    const pad = (n) => String(n).padStart(2, '0');
    return `${istDate.getUTCFullYear()}-${pad(istDate.getUTCMonth() + 1)}-${pad(istDate.getUTCDate())}T${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())}:${pad(istDate.getUTCSeconds())}+05:30`;
};

const formatNotification = (n) => {
    const obj = n.toJSON();
    obj.created_at = toISTString(obj.created_at);
    obj.updated_at = toISTString(obj.updated_at);
    obj.createdAt = obj.created_at;
    obj.updatedAt = obj.updated_at;
    return obj;
};

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

        res.json({ total: notifications.length, notifications: notifications.map(formatNotification) });
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
