const { Venue, RoleAssignment, Role, User, Student, Faculty, Staff, RoleUser, Task, TaskType, TaskAssign } = require('../models');
const { Op, literal } = require('sequelize');

// Helper: format YYYY-MM-DD safely
function toDateStr(dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
}

// Helper: batch fetch creator names by user_id
async function fetchCreatorNames(userIds) {
    if (!userIds || userIds.length === 0) return {};
    const creators = await User.findAll({
        where: { user_id: userIds },
        include: [
            { model: Student, attributes: ['name'], required: false },
            { model: Faculty, attributes: ['name'], required: false },
            { model: Staff, attributes: ['name'], required: false },
            { model: RoleUser, attributes: ['name'], required: false },
            {
                model: RoleAssignment,
                required: false,
                include: [{ model: Role, attributes: ['user_role'] }]
            }
        ]
    });

    const map = {};
    creators.forEach(c => {
        const profile = c.Student || c.Faculty || c.Staff || c.RoleUser;
        let roleLabel = c.role ? (c.role.charAt(0).toUpperCase() + c.role.slice(1).toLowerCase()) : 'User';

        // If it's a role-user, prioritize the specific roles assigned
        if (c.role === 'role-user' && c.RoleAssignments && c.RoleAssignments.length > 0) {
            const specificRoles = c.RoleAssignments
                .map(ra => ra.Role?.user_role)
                .filter(Boolean);
            if (specificRoles.length > 0) {
                // Join multiple roles if they exist, e.g. "HOD, Principal"
                roleLabel = [...new Set(specificRoles)].join(', ');
            }
        }

        if (profile) {
            map[c.user_id] = `${profile.name} (${roleLabel})`;
        } else if (c.role && c.role.toLowerCase() === 'admin') {
            map[c.user_id] = 'Admin';
        } else {
            map[c.user_id] = `${roleLabel} #${c.user_id}`;
        }
    });
    return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venue-dashboard?date=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
exports.getVenueDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { date, venue_id } = req.query;

        // Build target date string in IST
        let dateStr;
        if (date) {
            dateStr = date; // Use as-is (YYYY-MM-DD)
        } else {
            const now = new Date();
            const istOffset = 330 * 60 * 1000;
            const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
            dateStr = toDateStr(localNow);
        }

        // 1. Find venues this incharge manages
        const whereClause = { user_id: userId, venue_id: { [Op.ne]: null } };
        if (venue_id) {
            whereClause.venue_id = venue_id;
        }

        const userAssignments = await RoleAssignment.findAll({
            where: whereClause,
            attributes: ['venue_id']
        });

        const assignedVenueIds = [...new Set(userAssignments.map(a => a.venue_id))];

        if (assignedVenueIds.length === 0) {
            return res.json({
                date: dateStr,
                total_venues: 0,
                venues: [],
                message: venue_id ? "You are not an incharge of this specific venue." : "No venues found for this incharge."
            });
        }

        // 2. Fetch venue details with incharge info
        const venues = await Venue.findAll({
            where: { venue_id: { [Op.in]: assignedVenueIds } },
            include: [{
                model: RoleAssignment,
                include: [{
                    model: User,
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name'], required: false },
                        { model: Faculty, attributes: ['name'], required: false },
                        { model: Staff, attributes: ['name'], required: false },
                        { model: RoleUser, attributes: ['name'], required: false }
                    ]
                }]
            }]
        });

        const dashboardData = [];

        for (const venue of venues) {
            const incharges = (venue.RoleAssignments || []).map(ra => {
                const u = ra.User;
                if (!u) return 'Unknown';
                const profile = u.Student || u.Faculty || u.Staff || u.RoleUser;
                return profile ? profile.name : `User #${u.user_id}`;
            });

            // 3. Fetch tasks for this venue on target date
            //    Check venue_id in BOTH task_types.venue_id AND tasks.venue_id
            const todaysTasks = await Task.findAll({
                where: { is_deleted: false },
                attributes: ['task_id', 'title', 'description', 'category', 'priority', 'is_approved', 'creator_id'],
                include: [
                    {
                        model: TaskType,
                        required: true,
                        attributes: ['start_time', 'end_time', 'start_date', 'end_date'],
                        where: {
                            [Op.and]: [
                                // Date match
                                {
                                    [Op.or]: [
                                        literal(`DATE(\`TaskTypes\`.\`start_date\`) = '${dateStr}'`),
                                        {
                                            [Op.and]: [
                                                literal(`DATE(\`TaskTypes\`.\`start_date\`) <= '${dateStr}'`),
                                                literal(`DATE(\`TaskTypes\`.\`end_date\`) >= '${dateStr}'`)
                                            ]
                                        }
                                    ]
                                },
                                // Venue match: task_types.venue_id OR tasks.venue_id
                                {
                                    [Op.or]: [
                                        { venue_id: venue.venue_id },
                                        literal(`\`Task\`.\`venue_id\` = ${venue.venue_id}`)
                                    ]
                                }
                            ]
                        }
                    },
                    {
                        // Get the incharge's own task_assign record to determine status
                        model: TaskAssign,
                        required: false,
                        attributes: ['status', 'user_id'],
                        where: { user_id: userId }
                    }
                ]
            });

            // Batch fetch creator names
            const creatorIds = [...new Set(todaysTasks.map(t => t.creator_id).filter(Boolean))];
            const creatorMap = await fetchCreatorNames(creatorIds);

            const bookedTasks = [];
            const pendingTasksForDay = [];
            let totalMinutesUsed = 0;

            todaysTasks.forEach(t => {
                const tt = t.TaskTypes?.[0];

                // Split based on incharge's task_assign status (not task.is_approved)
                const inchargeAssignment = t.TaskAssigns?.find(ta => ta.user_id == userId);
                const inchargeStatus = inchargeAssignment?.status || null;

                const taskDetail = {
                    task_id: t.task_id,
                    title: t.title,
                    description: t.description,
                    category: t.category,
                    priority: t.priority,
                    booked_by: creatorMap[t.creator_id] || `User #${t.creator_id}`,
                    venue_approval_status: inchargeStatus || 'not_assigned',
                    timing: tt ? {
                        start_time: tt.start_time,
                        end_time: tt.end_time,
                        start_date: tt.start_date,
                        end_date: tt.end_date
                    } : null
                };

                if (inchargeStatus === 'accepted') {
                    // Incharge approved — it's a confirmed booked slot
                    bookedTasks.push(taskDetail);
                    if (tt && tt.start_time && tt.end_time) {
                        const [sH, sM] = tt.start_time.split(':').map(Number);
                        const [eH, eM] = tt.end_time.split(':').map(Number);
                        const duration = (eH * 60 + eM) - (sH * 60 + sM);
                        if (duration > 0) totalMinutesUsed += duration;
                    }
                } else if (inchargeStatus === 'pending') {
                    // Incharge hasn't acted yet — awaiting their approval
                    pendingTasksForDay.push(taskDetail);
                }
                // rejected tasks are intentionally excluded from dashboard
            });

            // Calculate operational/booking status
            let current_status = venue.status || 'open';
            if (current_status === 'open') {
                if (bookedTasks.length === 0 && pendingRequests.length === 0) {
                    current_status = 'free';
                } else if (bookedTasks.length > 0 && pendingRequests.length === 0) {
                    current_status = 'fully_booked';
                } else if (bookedTasks.length > 0) {
                    current_status = 'partially_booked';
                } else {
                    current_status = 'requests_pending';
                }
            }

            // Lifetime accepted assignments for this venue
            const totalAcceptedAssignments = await TaskAssign.count({
                include: [{
                    model: Task,
                    where: { venue_id: venue.venue_id, is_deleted: false }
                }],
                where: { status: 'accepted' }
            });

            const operationalWindow = 720;
            const usagePercentage = Math.min((totalMinutesUsed / operationalWindow) * 100, 100).toFixed(2);

            dashboardData.push({
                venue_id: venue.venue_id,
                name: venue.name,
                type: venue.venue_type,
                location: venue.location,
                current_status: current_status,
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
            date: dateStr,
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
        const { days = 2, venue_id } = req.query;

        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const toDate = new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate());
        const fromDate = new Date(toDate);
        fromDate.setDate(fromDate.getDate() - parseInt(days));

        const fromStr = toDateStr(fromDate);
        const toStr = toDateStr(toDate);

        // 1. Find venues user manages
        const whereClause = { user_id: userId, venue_id: { [Op.ne]: null } };
        if (venue_id) {
            whereClause.venue_id = venue_id;
        }

        const userAssignments = await RoleAssignment.findAll({
            where: whereClause,
            attributes: ['venue_id']
        });

        const assignedVenueIds = [...new Set(userAssignments.map(a => a.venue_id))];

        if (assignedVenueIds.length === 0) {
            return res.json({
                history_range_days: parseInt(days),
                from: fromStr,
                to: toStr,
                total_history_items: 0,
                history: [],
                message: venue_id ? "You are not an incharge of this specific venue." : "No venues managed."
            });
        }

        // 2. Fetch historical tasks
        const tasks = await Task.findAll({
            where: { is_deleted: false },
            attributes: ['task_id', 'title', 'category', 'is_approved', 'creator_id'],
            include: [
                {
                    model: TaskType,
                    required: true,
                    attributes: ['start_time', 'end_time', 'start_date', 'end_date'],
                    where: {
                        [Op.and]: [
                            {
                                [Op.or]: [
                                    { venue_id: { [Op.in]: assignedVenueIds } },
                                    literal(`\`Task\`.\`venue_id\` IN (${assignedVenueIds.join(',')})`)
                                ]
                            },
                            {
                                [Op.or]: [
                                    literal(`DATE(\`TaskTypes\`.\`start_date\`) BETWEEN '${fromStr}' AND '${toStr}'`),
                                    literal(`DATE(\`TaskTypes\`.\`end_date\`) BETWEEN '${fromStr}' AND '${toStr}'`)
                                ]
                            }
                        ]
                    }
                },
                {
                    model: TaskAssign,
                    required: false,
                    attributes: ['status', 'user_id'],
                    where: { user_id: userId }
                },
                {
                    model: Venue,
                    attributes: ['name', 'venue_type', 'location']
                }
            ],
            order: [[TaskType, 'start_date', 'DESC'], [TaskType, 'start_time', 'DESC']]
        });

        // Batch fetch creator names
        const creatorIds = [...new Set(tasks.map(t => t.creator_id).filter(Boolean))];
        const creatorMap = await fetchCreatorNames(creatorIds);

        const formattedHistory = tasks.map(t => {
            const tt = t.TaskTypes?.[0];
            const inchargeAssignment = t.TaskAssigns?.find(ta => ta.user_id == userId);
            const inchargeStatus = inchargeAssignment?.status || 'N/A';

            return {
                venue_name: t.Venue?.name,
                task_id: t.task_id,
                title: t.title,
                category: t.category,
                booked_by: creatorMap[t.creator_id] || `User #${t.creator_id}`,
                venue_approval_status: inchargeStatus,
                date: tt?.start_date,
                timing: tt ? `${tt.start_time} - ${tt.end_time}` : 'N/A'
            };
        });

        res.json({
            history_range_days: parseInt(days),
            from: fromStr,
            to: toStr,
            total_history_items: formattedHistory.length,
            history: formattedHistory
        });

    } catch (error) {
        console.error('Error in getVenueHistory:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venue/:id/details
// Returns full venue profile: photo, description, incharges, today's status,
// overall task count, and new pending booking requests
// ─────────────────────────────────────────────────────────────────────────────
exports.getVenueDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;

        // Today's date in IST
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = toDateStr(new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate()));

        // 1. Fetch venue info
        const venue = await Venue.findByPk(id, {
            include: [{
                model: RoleAssignment,
                include: [{
                    model: User,
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'email'], required: false },
                        { model: Faculty, attributes: ['name', 'email'], required: false },
                        { model: Staff, attributes: ['name', 'email'], required: false },
                        { model: RoleUser, attributes: ['name', 'email'], required: false }
                    ]
                }]
            }]
        });

        if (!venue) {
            return res.status(404).json({ message: 'Venue not found' });
        }

        // 2. Build incharge list
        const incharges = (venue.RoleAssignments || []).map(ra => {
            const u = ra.User;
            if (!u) return null;
            const profile = u.Student || u.Faculty || u.Staff || u.RoleUser;
            return profile ? {
                user_id: u.user_id,
                name: profile.name,
                email: profile.email || null
            } : null;
        }).filter(Boolean);

        // 3. Today's bookings for this venue (all tasks on today with venue match)
        const todaysTasks = await Task.findAll({
            where: { is_deleted: false },
            attributes: ['task_id', 'title', 'creator_id'],
            include: [
                {
                    model: TaskType,
                    required: true,
                    attributes: ['start_time', 'end_time', 'start_date'],
                    where: {
                        [Op.and]: [
                            {
                                [Op.or]: [
                                    { venue_id: parseInt(id) },
                                    literal(`\`Task\`.\`venue_id\` = ${parseInt(id)}`)
                                ]
                            },
                            {
                                [Op.or]: [
                                    literal(`DATE(\`TaskTypes\`.\`start_date\`) = '${dateStr}'`),
                                    {
                                        [Op.and]: [
                                            literal(`DATE(\`TaskTypes\`.\`start_date\`) <= '${dateStr}'`),
                                            literal(`DATE(\`TaskTypes\`.\`end_date\`) >= '${dateStr}'`)
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                },
                {
                    model: TaskAssign,
                    required: false,
                    attributes: ['status', 'user_id'],
                    where: { user_id: userId }
                }
            ]
        });

        // 4. Categorize today's tasks
        const confirmedBookings = [];
        const pendingRequests = [];

        // Collect creator IDs for batch fetching
        const creatorIds = [...new Set(todaysTasks.map(t => t.creator_id).filter(Boolean))];
        const creatorMap = await fetchCreatorNames(creatorIds);

        todaysTasks.forEach(t => {
            const tt = t.TaskTypes?.[0];
            const myAssign = t.TaskAssigns?.find(a => a.user_id == userId);
            const status = myAssign?.status || null;

            const entry = {
                task_id: t.task_id,
                title: t.title,
                timing: tt ? `${tt.start_time} - ${tt.end_time}` : 'N/A',
                from_time: tt ? tt.start_time : null,
                to_time: tt ? tt.end_time : null,
                booked_by: creatorMap[t.creator_id] || `User #${t.creator_id}`
            };

            if (status === 'accepted') confirmedBookings.push(entry);
            else if (status === 'pending') pendingRequests.push(entry);
        });

        // 5. Current status label
        let currentStatus;
        if (confirmedBookings.length === 0 && pendingRequests.length === 0) {
            currentStatus = 'free';
        } else if (confirmedBookings.length > 0 && pendingRequests.length === 0) {
            currentStatus = 'fully_booked';
        } else if (confirmedBookings.length > 0) {
            currentStatus = 'partially_booked';
        } else {
            currentStatus = 'requests_pending';
        }

        // 6. Overall total tasks (all time) for this venue
        const totalTaskCount = await Task.count({
            where: {
                is_deleted: false,
                [Op.or]: [
                    { venue_id: parseInt(id) },
                    literal(`\`Task\`.\`task_id\` IN (SELECT task_id FROM task_types WHERE venue_id = ${parseInt(id)})`)
                ]
            }
        });

        res.json({
            venue_id: venue.venue_id,
            name: venue.name,
            type: venue.venue_type,
            location: venue.location,
            description: venue.description || null,
            photo: venue.image_url || null,
            incharges,

            today: {
                date: dateStr,
                status: currentStatus,                     // free | fully_booked | partially_booked | requests_pending
                confirmed_bookings_count: confirmedBookings.length,
                pending_requests_count: pendingRequests.length,
                confirmed_bookings: confirmedBookings,
                pending_requests: pendingRequests
            },

            overall: {
                total_tasks: totalTaskCount                 // all-time task count for this venue
            }
        });

    } catch (error) {
        console.error('Error in getVenueDetails:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venue-details
// Token-based: Returns detailed summaries for ALL venues managed by the incharge
// ─────────────────────────────────────────────────────────────────────────────
exports.getManagedVenuesDetails = async (req, res) => {
    try {
        const userId = req.userId;

        // Today's date in IST
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = toDateStr(new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate()));

        const { venue_id } = req.query;

        // 1. Identify which venues this user is incharge of
        const whereClause = { user_id: userId, venue_id: { [Op.ne]: null } };
        if (venue_id) {
            whereClause.venue_id = venue_id;
        }

        const userAssignments = await RoleAssignment.findAll({
            where: whereClause,
            attributes: ['venue_id']
        });

        const assignedVenueIds = [...new Set(userAssignments.map(a => a.venue_id))];

        if (assignedVenueIds.length === 0) {
            return res.json({
                date: dateStr,
                total_venues: 0,
                venues: [],
                message: venue_id ? "You are not an incharge of this specific venue." : "No venues managed by this user."
            });
        }

        // 2. Fetch venues
        const venues = await Venue.findAll({
            where: { venue_id: { [Op.in]: assignedVenueIds } }
        });

        const detailedVenues = [];

        for (const venue of venues) {
            // Task Count (Overall)
            const totalTaskCount = await Task.count({
                where: {
                    is_deleted: false,
                    [Op.or]: [
                        { venue_id: venue.venue_id },
                        literal(`\`Task\`.\`task_id\` IN (SELECT task_id FROM task_types WHERE venue_id = ${venue.venue_id})`)
                    ]
                }
            });

            // Today's tasks
            const todaysTasks = await Task.findAll({
                where: { is_deleted: false },
                include: [
                    {
                        model: TaskType,
                        required: true,
                        where: {
                            [Op.and]: [
                                { [Op.or]: [{ venue_id: venue.venue_id }, literal(`\`Task\`.\`venue_id\` = ${venue.venue_id}`)] },
                                {
                                    [Op.or]: [
                                        literal(`DATE(\`TaskTypes\`.\`start_date\`) = '${dateStr}'`),
                                        { [Op.and]: [literal(`DATE(\`TaskTypes\`.\`start_date\`) <= '${dateStr}'`), literal(`DATE(\`TaskTypes\`.\`end_date\`) >= '${dateStr}'`)] }
                                    ]
                                }
                            ]
                        }
                    },
                    {
                        model: TaskAssign,
                        where: { user_id: userId },
                        required: false
                    }
                ]
            });

            const confirmedBookings = [];
            const pendingRequests = [];

            // Collect creator IDs for batch names
            const creatorIds = [...new Set(todaysTasks.map(t => t.creator_id).filter(Boolean))];
            const creatorMap = await fetchCreatorNames(creatorIds);

            todaysTasks.forEach(t => {
                const tt = t.TaskTypes?.[0];
                const myAssign = t.TaskAssigns?.find(a => a.user_id == userId);
                const status = myAssign?.status || null;

                const entry = {
                    task_id: t.task_id,
                    title: t.title,
                    from_time: tt ? tt.start_time : null,
                    to_time: tt ? tt.end_time : null,
                    booked_by: creatorMap[t.creator_id] || `User #${t.creator_id}`
                };

                if (status === 'accepted') confirmedBookings.push(entry);
                else if (status === 'pending') pendingRequests.push(entry);
            });

            let currentStatus = 'free';
            if (confirmedBookings.length > 0 && pendingRequests.length > 0) currentStatus = 'partially_booked';
            else if (confirmedBookings.length > 0) currentStatus = 'fully_booked';
            else if (pendingRequests.length > 0) currentStatus = 'requests_pending';

            detailedVenues.push({
                venue_id: venue.venue_id,
                name: venue.name,
                type: venue.venue_type,
                location: venue.location,
                photo: venue.image_url || null,
                current_status: venue.status || currentStatus,
                booking_status: currentStatus,
                overall_total_tasks: totalTaskCount,
                new_requests_pending_count: pendingRequests.length,
                today: {
                    date: dateStr,
                    confirmed_bookings_count: confirmedBookings.length,
                    confirmed_bookings: confirmedBookings
                }
            });
        }

        res.json({
            date: dateStr,
            total_venues_managed: venues.length,
            venues: detailedVenues
        });

    } catch (error) {
        console.error('Error in getManagedVenuesDetails:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venues/my-list
// Returns a lightweight list of venues managed by the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
exports.getMyVenuesList = async (req, res) => {
    try {
        const userId = req.userId;

        // 1. Identify venue IDs this user is incharge of
        const userAssignments = await RoleAssignment.findAll({
            where: { user_id: userId, venue_id: { [Op.ne]: null } },
            attributes: ['venue_id']
        });

        const assignedVenueIds = [...new Set(userAssignments.map(a => a.venue_id))];

        if (assignedVenueIds.length === 0) {
            return res.json({
                success: true,
                count: 0,
                venues: []
            });
        }

        // 2. Fetch basic venue info
        const venues = await Venue.findAll({
            where: { venue_id: { [Op.in]: assignedVenueIds } },
            attributes: ['venue_id', 'name', 'venue_type', 'location', 'image_url', 'description']
        });

        // 3. Optional: Add Today's Booking Count for each venue
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
        const dateStr = toDateStr(localNow);

        const result = await Promise.all(venues.map(async (v) => {
            const bookingCount = await Task.count({
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        venue_id: v.venue_id,
                        [Op.or]: [
                            literal(`DATE(start_date) = '${dateStr}'`),
                            { [Op.and]: [literal(`DATE(start_date) <= '${dateStr}'`), literal(`DATE(end_date) >= '${dateStr}'`)] }
                        ]
                    }
                }]
            });

            return {
                venue_id: v.venue_id,
                name: v.name,
                type: v.venue_type,
                location: v.location,
                image: v.image_url,
                todays_bookings: bookingCount
            };
        }));

        res.json({
            success: true,
            total_managed: result.length,
            venues: result
        });

    } catch (error) {
        console.error('Error in getMyVenuesList:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tasks/venue/:id/status
// Updates the operational status of a specific venue
// ─────────────────────────────────────────────────────────────────────────────
exports.updateVenueStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reason } = req.body;
        const userId = req.userId;

        const venue = await Venue.findByPk(id);
        if (!venue) {
            return res.status(404).json({ message: 'Venue not found' });
        }

        // ONE-TIME DB FIX (Truncation issue)
        try {
            await Venue.sequelize.query("ALTER TABLE maintenance_logs MODIFY category VARCHAR(100) NOT NULL;");
        } catch (dbErr) {
            // Silently fail if already altered or permission issue
        }

        // Validate Status against ENUM: 'open', 'under maintenance', 'temporarily closed', 'renovation', 'full day booked'
        const validStatuses = ['open', 'under maintenance', 'temporarily closed', 'renovation', 'full day booked'];
        const formattedStatus = status.toLowerCase().replace(/_/g, ' ');
        let effectiveStatus = formattedStatus;

        // Fallbacks for custom UI statuses
        if (!validStatuses.includes(effectiveStatus)) {
             if (formattedStatus.includes('maintenance')) effectiveStatus = 'under maintenance';
             else if (formattedStatus.includes('close')) effectiveStatus = 'temporarily closed';
             else if (formattedStatus.includes('reserve')) effectiveStatus = 'full day booked';
             else effectiveStatus = 'open'; // default
        }

        const oldStatus = venue.status || 'open';
        venue.status = effectiveStatus;
        await venue.save();

        // Always log the change to preserve genuine history
        const { MaintenanceLog } = require('../models');
        await MaintenanceLog.create({
            venue_id: id,
            category: 'Status Change',
            issue_title: `Status: ${oldStatus.toUpperCase()} -> ${effectiveStatus.toUpperCase()}`,
            description: reason || 'Manual status update by Incharge/Admin',
            status: effectiveStatus === 'open' ? 'completed' : 'in_progress',
            start_time: new Date()
        });

        res.json({
            success: true,
            message: 'Venue status updated successfully',
            venue_id: id,
            status: venue.status
        });

    } catch (error) {
        console.error('Error in updateVenueStatus:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
