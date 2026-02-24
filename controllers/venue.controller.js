const { Venue, RoleAssignment, User, Student, Faculty, Staff, RoleUser, Task, TaskType, TaskAssign } = require('../models');
const { Op } = require('sequelize');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venue-dashboard
// Returns today's (or a specific date's) booking details for incharge's venues
// ─────────────────────────────────────────────────────────────────────────────
exports.getVenueDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { date } = req.query; // optional YYYY-MM-DD

        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        let targetDateStart, targetDateEnd;
        if (date) {
            targetDateStart = new Date(date);
            targetDateStart.setHours(0, 0, 0, 0);
            targetDateEnd = new Date(date);
            targetDateEnd.setHours(23, 59, 59, 999);
        } else {
            targetDateStart = new Date(localNow);
            targetDateStart.setHours(0, 0, 0, 0);
            targetDateEnd = new Date(localNow);
            targetDateEnd.setHours(23, 59, 59, 999);
        }

        const todayStr = targetDateStart.toISOString().split('T')[0];

        // 1. Identify which venues this user is incharge of
        const userAssignments = await RoleAssignment.findAll({
            where: { user_id: userId, venue_id: { [Op.ne]: null } },
            attributes: ['venue_id']
        });

        const assignedVenueIds = [...new Set(userAssignments.map(a => a.venue_id))];

        if (assignedVenueIds.length === 0) {
            return res.json({
                date: todayStr,
                total_venues: 0,
                venues: [],
                message: "No venues found for this incharge."
            });
        }

        // 2. Fetch venue details
        const venues = await Venue.findAll({
            where: { venue_id: { [Op.in]: assignedVenueIds } },
            include: [
                {
                    model: RoleAssignment,
                    include: [{
                        model: User,
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }]
                }
            ]
        });

        const dashboardData = [];

        for (const venue of venues) {
            // Find Incharges
            const incharges = venue.RoleAssignments?.map(ra => {
                const u = ra.User;
                const profile = u.Student || u.Faculty || u.Staff || u.RoleUser;
                return profile ? profile.name : 'Unknown';
            }) || [];

            // All tasks for the day
            const todaysTasks = await Task.findAll({
                where: { venue_id: venue.venue_id, is_deleted: false },
                include: [
                    {
                        model: TaskType,
                        required: true,
                        where: {
                            [Op.or]: [
                                { start_date: { [Op.between]: [targetDateStart, targetDateEnd] } },
                                { end_date: { [Op.between]: [targetDateStart, targetDateEnd] } },
                                {
                                    [Op.and]: [
                                        { start_date: { [Op.lte]: targetDateStart } },
                                        { end_date: { [Op.gte]: targetDateEnd } }
                                    ]
                                }
                            ]
                        }
                    },
                    {
                        model: User,
                        as: 'Creator',
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name', 'email'] },
                            { model: Faculty, attributes: ['name', 'email'] },
                            { model: Staff, attributes: ['name', 'email'] },
                            { model: RoleUser, attributes: ['name', 'email'] }
                        ]
                    }
                ]
            });

            const bookedTasks = [];
            const pendingTasksForDay = [];
            let totalMinutesUsed = 0;

            todaysTasks.forEach(t => {
                const tt = t.TaskTypes?.[0];
                const creatorProfile = t.Creator?.Student || t.Creator?.Faculty || t.Creator?.Staff || t.Creator?.RoleUser;

                const taskDetail = {
                    task_id: t.task_id,
                    title: t.title,
                    description: t.description,
                    category: t.category,
                    priority: t.priority,
                    booked_by: creatorProfile ? creatorProfile.name : 'Unknown',
                    timing: tt ? {
                        start_time: tt.start_time,
                        end_time: tt.end_time,
                        start_date: tt.start_date,
                        end_date: tt.end_date
                    } : null
                };

                if (t.is_approved) {
                    bookedTasks.push(taskDetail);
                    if (tt && tt.start_time && tt.end_time) {
                        const [sH, sM] = tt.start_time.split(':').map(Number);
                        const [eH, eM] = tt.end_time.split(':').map(Number);
                        const duration = (eH * 60 + eM) - (sH * 60 + sM);
                        if (duration > 0) totalMinutesUsed += duration;
                    }
                } else {
                    pendingTasksForDay.push(taskDetail);
                }
            });

            // Overall venue stats
            const totalAcceptedAssignments = await TaskAssign.count({
                include: [{
                    model: Task,
                    where: { venue_id: venue.venue_id, is_deleted: false }
                }],
                where: { status: 'accepted' }
            });

            const operationalWindow = 720; // 8 AM - 8 PM
            const usagePercentage = Math.min((totalMinutesUsed / operationalWindow) * 100, 100).toFixed(2);

            dashboardData.push({
                venue_id: venue.venue_id,
                name: venue.name,
                type: venue.venue_type,
                location: venue.location,
                incharges,
                stats: {
                    total_tasks_accepted: totalAcceptedAssignments,
                    booked_count: bookedTasks.length,
                    pending_approval_count: pendingTasksForDay.length,
                    today_usage_percentage: `${usagePercentage}%`,
                    minutes_used_today: totalMinutesUsed
                },
                booked_tasks: bookedTasks,
                pending_approval_tasks: pendingTasksForDay
            });
        }

        res.json({
            date: todayStr,
            total_venues_managed: venues.length,
            venues: dashboardData
        });

    } catch (error) {
        console.error('Error in getVenueDashboard:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venue-history?days=2
// Returns booking history for past N days for the incharge's venues
// ─────────────────────────────────────────────────────────────────────────────
exports.getVenueHistory = async (req, res) => {
    try {
        const userId = req.userId;
        const { days = 2 } = req.query; // Default: past 2 days

        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        // History range: from X days ago (start of day) to now (end of today)
        const historyStart = new Date(localNow);
        historyStart.setDate(historyStart.getDate() - parseInt(days));
        historyStart.setHours(0, 0, 0, 0);

        const historyEnd = new Date(localNow);
        historyEnd.setHours(23, 59, 59, 999);

        // 1. Find venues user manages
        const userAssignments = await RoleAssignment.findAll({
            where: { user_id: userId, venue_id: { [Op.ne]: null } },
            attributes: ['venue_id']
        });

        const assignedVenueIds = [...new Set(userAssignments.map(a => a.venue_id))];

        if (assignedVenueIds.length === 0) {
            return res.json({
                history_range_days: days,
                from: historyStart.toISOString().split('T')[0],
                to: historyEnd.toISOString().split('T')[0],
                total_history_items: 0,
                history: [],
                message: "No venues managed."
            });
        }

        // 2. Fetch all historical tasks for these venues
        const tasks = await Task.findAll({
            where: {
                venue_id: { [Op.in]: assignedVenueIds },
                is_deleted: false
            },
            include: [
                {
                    model: TaskType,
                    required: true,
                    where: {
                        [Op.or]: [
                            { start_date: { [Op.between]: [historyStart, historyEnd] } },
                            { end_date: { [Op.between]: [historyStart, historyEnd] } }
                        ]
                    }
                },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['user_id'],
                    include: [
                        { model: Student, attributes: ['name'] },
                        { model: Faculty, attributes: ['name'] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                },
                {
                    model: Venue,
                    attributes: ['name', 'venue_type', 'location']
                }
            ],
            order: [[TaskType, 'start_date', 'DESC'], [TaskType, 'start_time', 'DESC']]
        });

        const formattedHistory = tasks.map(t => {
            const tt = t.TaskTypes?.[0];
            const creator = t.Creator?.Student || t.Creator?.Faculty || t.Creator?.Staff || t.Creator?.RoleUser;

            return {
                venue_name: t.Venue?.name,
                task_id: t.task_id,
                title: t.title,
                category: t.category,
                booked_by: creator ? creator.name : 'Unknown',
                status: t.is_approved ? 'Approved / Booked' : 'Pending / Not Approved',
                date: tt?.start_date,
                timing: tt ? `${tt.start_time} - ${tt.end_time}` : 'N/A'
            };
        });

        res.json({
            history_range_days: parseInt(days),
            from: historyStart.toISOString().split('T')[0],
            to: historyEnd.toISOString().split('T')[0],
            total_history_items: formattedHistory.length,
            history: formattedHistory
        });

    } catch (error) {
        console.error('Error in getVenueHistory:', error);
        res.status(500).json({ message: error.message });
    }
};
