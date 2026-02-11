const { Task, TaskAssign, TaskAcknowledgment, User } = require('../models');
const { Op } = require('sequelize');

// Acknowledge today's tasks
exports.acknowledgeTodaysTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // Get all tasks assigned to user for today (you'll need to add date filtering based on task type)
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{ model: Task }]
        });

        const acknowledged = [];

        for (const assignment of assignments) {
            // Create or update acknowledgment
            const [ack, created] = await TaskAcknowledgment.findOrCreate({
                where: {
                    task_id: assignment.task_id,
                    user_id: userId,
                    acknowledge_date: today
                },
                defaults: {
                    acknowledged_at: new Date()
                }
            });

            if (!created && !ack.acknowledged_at) {
                await ack.update({ acknowledged_at: new Date() });
            }

            acknowledged.push({
                task_id: assignment.task_id,
                task_title: assignment.Task.title,
                acknowledged_at: ack.acknowledged_at
            });
        }

        res.json({
            message: 'Tasks acknowledged successfully',
            count: acknowledged.length,
            tasks: acknowledged
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get today's unacknowledged tasks
exports.getTodaysUnacknowledgedTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const today = new Date().toISOString().split('T')[0];

        // Get all pending task assignments
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{ model: Task }]
        });

        const unacknowledged = [];

        for (const assignment of assignments) {
            const ack = await TaskAcknowledgment.findOne({
                where: {
                    task_id: assignment.task_id,
                    user_id: userId,
                    acknowledge_date: today
                }
            });

            if (!ack || !ack.acknowledged_at) {
                unacknowledged.push({
                    task_id: assignment.task_id,
                    task_title: assignment.Task.title,
                    task_description: assignment.Task.description,
                    priority: assignment.Task.priority,
                    category: assignment.Task.category
                });
            }
        }

        res.json({
            date: today,
            count: unacknowledged.length,
            tasks: unacknowledged
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get user's acknowledgment history
exports.getAcknowledgmentHistory = async (req, res) => {
    try {
        const userId = req.userId;
        const { days = 7 } = req.query; // Default to last 7 days

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        const acknowledgments = await TaskAcknowledgment.findAll({
            where: {
                user_id: userId,
                acknowledge_date: {
                    [Op.gte]: startDate.toISOString().split('T')[0]
                }
            },
            include: [{ model: Task, attributes: ['task_id', 'title', 'category', 'priority'] }],
            order: [['acknowledge_date', 'DESC']]
        });

        res.json({
            days: parseInt(days),
            count: acknowledgments.length,
            acknowledgments: acknowledgments.map(ack => ({
                task_id: ack.task_id,
                task_title: ack.Task?.title,
                task_category: ack.Task?.category,
                task_priority: ack.Task?.priority,
                acknowledge_date: ack.acknowledge_date,
                acknowledged_at: ack.acknowledged_at,
                status: ack.acknowledged_at ? 'acknowledged' : 'pending'
            }))
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Cron job function: Check morning acknowledgments (08:30 AM)
exports.checkMorningAcknowledgment = async () => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Find all unacknowledged tasks for today
        const unacknowledged = await TaskAcknowledgment.findAll({
            where: {
                acknowledge_date: today,
                acknowledged_at: null
            },
            include: [
                { model: Task },
                { model: User, attributes: ['user_id', 'role'] }
            ]
        });

        console.log(`[CRON] Found ${unacknowledged.length} unacknowledged tasks for ${today}`);

        for (const ack of unacknowledged) {
            // Set task escalation flag
            await ack.Task.update({ is_escalate: true });

            // TODO: Send notification to task creator
            console.log(`[CRON] Escalated task ${ack.task_id} - User ${ack.user_id} did not acknowledge by 08:30 AM`);
            // await sendEscalationNotification(ack.Task.creator_id, ack.user_id, ack.Task);
        }

        return { count: unacknowledged.length };

    } catch (error) {
        console.error('[CRON ERROR] checkMorningAcknowledgment:', error.message);
        return { error: error.message };
    }
};

// Cron job function: Cleanup old acknowledgments (01:00 AM)
exports.cleanupOldAcknowledgments = async () => {
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

        const result = await TaskAcknowledgment.destroy({
            where: {
                acknowledge_date: {
                    [Op.lt]: cutoffDate
                }
            }
        });

        console.log(`[CRON] Deleted ${result} acknowledgments older than ${cutoffDate}`);
        return { deleted: result };

    } catch (error) {
        console.error('[CRON ERROR] cleanupOldAcknowledgments:', error.message);
        return { error: error.message };
    }
};

module.exports = exports;
