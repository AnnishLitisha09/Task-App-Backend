const { Venue, RoleAssignment, Role, User, Student, Faculty, Staff, RoleUser, Task, TaskType, TaskAssign } = require('../models');
const { Op, literal } = require('sequelize');
const xlsx = require('xlsx');

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
        let roleName = c.role ? (c.role.charAt(0).toUpperCase() + c.role.slice(1).toLowerCase()) : 'User';

        // Advanced role-label for role-user (HOD, Principal, etc.)
        if (c.role === 'role-user' && c.RoleAssignments && c.RoleAssignments.length > 0) {
            const specificRoles = c.RoleAssignments
                .map(ra => ra.Role?.user_role)
                .filter(Boolean);
            if (specificRoles.length > 0) {
                roleName = [...new Set(specificRoles)].join(', ');
            }
        }

        if (profile) {
            map[c.user_id] = `${profile.name} (${roleName})`;
        } else if (c.role && c.role.toLowerCase() === 'admin') {
            map[c.user_id] = `Administrator (Admin)`;
        } else {
            map[c.user_id] = `User #${c.user_id} (${roleName})`;
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
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
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
                    is_package: t.is_package, // Added
                    booked_by: creatorMap[t.creator_id] || `Unknown User (${t.creator_id})`,
                    venue_approval_status: inchargeStatus || 'not_assigned',
                    timing: tt ? {
                        start_time: tt.start_time,
                        end_time: tt.end_time,
                        start_date: tt.start_date,
                        end_date: tt.end_date,
                        task_name: tt.task_name // Added
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
                if (bookedTasks.length === 0 && pendingTasksForDay.length === 0) {
                    current_status = 'free';
                } else if (bookedTasks.length > 0 && pendingTasksForDay.length === 0) {
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
            where: { 
                is_deleted: false,
                origin_type: { [Op.ne]: 'self-log' }
            },
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
                booked_by: creatorMap[t.creator_id] || `Unknown User (${t.creator_id})`,
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
            where: { 
                is_deleted: false,
                origin_type: { [Op.ne]: 'self-log' }
            },
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
                booked_by: creatorMap[t.creator_id] || `Unknown User (${t.creator_id})`
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
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
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
                    booked_by: creatorMap[t.creator_id] || `Unknown User (${t.creator_id})`
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
        const userRole = req.userRole?.toLowerCase();

        let assignedVenueIds = [];

        if (userRole === 'admin') {
            // Admins can see all venues
            const allVenues = await Venue.findAll({ attributes: ['venue_id'] });
            assignedVenueIds = allVenues.map(v => v.venue_id);
        } else {
            // 1. Identify venue IDs this user is incharge of
            const userAssignments = await RoleAssignment.findAll({
                where: { user_id: userId, venue_id: { [Op.ne]: null } },
                attributes: ['venue_id']
            });
            assignedVenueIds = [...new Set(userAssignments.map(a => a.venue_id))];
        }

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
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venues/all
// Returns a simple list of all venues for any authenticated user
// ─────────────────────────────────────────────────────────────────────────────
exports.getAllVenues = async (req, res) => {
    try {
        const { date, start_time, end_time } = req.query;

        // 1. Fetch all venues
        const venuesRaw = await Venue.findAll({
            attributes: ['venue_id', 'name', 'venue_type', 'location', 'image_url', 'description', 'status']
        });

        // Convert to plain objects so we can add dynamic properties
        const venues = venuesRaw.map(v => v.get({ plain: true }));

        // 2. If time constraints are provided, check for bookings
        let bookedVenueIds = [];
        if (date && start_time && end_time) {
            // Find tasks that overlap with this query time and occur on the query date
            const overlappingTasks = await Task.findAll({
                where: {
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' } // Self-logs don't block venues formally
                },
                include: [
                    {
                        model: TaskType,
                        required: true,
                        where: {
                            [Op.and]: [
                                // Date logic: Task occurs on the target date
                                {
                                    [Op.or]: [
                                        literal(`DATE(\`TaskTypes\`.\`start_date\`) = '${date}'`),
                                        {
                                            [Op.and]: [
                                                literal(`DATE(\`TaskTypes\`.\`start_date\`) <= '${date}'`),
                                                literal(`DATE(\`TaskTypes\`.\`end_date\`) >= '${date}'`)
                                            ]
                                        }
                                    ]
                                },
                                // Time overlap logic: task_start < query_end AND task_end > query_start
                                { start_time: { [Op.lt]: end_time } },
                                { end_time: { [Op.gt]: start_time } }
                            ]
                        }
                    },
                    {
                        model: TaskAssign,
                        required: true,
                        where: { status: { [Op.in]: ['accepted', 'in_progress'] } } // Only confirmed tasks block
                    }
                ]
            });

            // Extract venues that have bookings
            overlappingTasks.forEach(t => {
                const vid = t.venue_id || t.TaskTypes?.[0]?.venue_id;
                if (vid) {
                    bookedVenueIds.push(vid);
                }
            });
            bookedVenueIds = [...new Set(bookedVenueIds)];
        }

        // 3. Attach availability status
        venues.forEach(v => {
            // If the venue is globally under maintenance, closed, etc.
            if (v.status && v.status.toLowerCase() !== 'open') {
                v.booking_status = v.status;
            } else {
                // Venue is technically available, check bookings for the requested slot
                if (date && start_time && end_time) {
                    v.booking_status = bookedVenueIds.includes(v.venue_id) ? 'booked' : 'available';
                } else {
                    // No date/time passed; default to 'available' since we aren't identifying a slot
                    v.booking_status = 'available';
                }
            }
        });

        res.json({
            success: true,
            count: venues.length,
            venues
        });
    } catch (error) {
        console.error('Error in getAllVenues:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/venue/:id/basic
// Returns basic details for a specific venue
// ─────────────────────────────────────────────────────────────────────────────
exports.getVenueBasicDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const venue = await Venue.findByPk(id, {
            attributes: ['venue_id', 'name', 'venue_type', 'location', 'image_url', 'description', 'status']
        });

        if (!venue) {
            return res.status(404).json({ message: 'Venue not found' });
        }

        res.json({
            success: true,
            venue
        });
    } catch (error) {
        console.error('Error in getVenueBasicDetails:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/venues/usage-report
// Detailed venue usage report for a date range (default 1 month)
// ─────────────────────────────────────────────────────────────────────────────
exports.exportDetailedVenueReport = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole?.toLowerCase();
        const { from, to, venue_id } = req.query;

        // 1. Date Range Setup (Default last 30 days)
        const now = new Date();
        const endDate = to ? new Date(to) : now;
        const startDate = from ? new Date(from) : new Date(new Date().setDate(now.getDate() - 30));

        const fromStr = toDateStr(startDate);
        const toStr = toDateStr(endDate);

        // 2. Determine Venues
        let assignedVenueIds = [];
        if (userRole === 'admin') {
            const all = await Venue.findAll({ attributes: ['venue_id'] });
            assignedVenueIds = all.map(v => v.venue_id);
        } else {
            const assignments = await RoleAssignment.findAll({
                where: { user_id: userId, venue_id: { [Op.ne]: null } },
                attributes: ['venue_id']
            });
            assignedVenueIds = [...new Set(assignments.map(a => a.venue_id))];
        }

        if (venue_id) {
            const vid = parseInt(venue_id);
            if (!assignedVenueIds.includes(vid)) {
                return res.status(403).json({ message: "Access denied to this venue." });
            }
            assignedVenueIds = [vid];
        }

        if (assignedVenueIds.length === 0) {
            return res.status(404).json({ message: "No venues found for report." });
        }

        // 3. Fetch Tasks within range
        const tasks = await Task.findAll({
            where: { is_deleted: false },
            include: [
                {
                    model: TaskType,
                    required: true,
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
                { model: Venue, attributes: ['name', 'venue_type', 'location'] },
                { model: Resource, attributes: ['name'] },
                { 
                    model: User, as: 'Creator', 
                    include: [
                        { model: Student, attributes: ['name']}, 
                        { model: Faculty, attributes:['name']}, 
                        { model: Staff, attributes: ['name']}, 
                        { model: RoleUser, attributes: ['name']}
                    ] 
                },
                { 
                    model: TaskAssign, 
                    include: [{
                        model: User,
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

        // 4. Resolve Incharges
        const roleAssignments = await RoleAssignment.findAll({
            where: { venue_id: { [Op.in]: assignedVenueIds } },
            attributes: ['venue_id', 'user_id']
        });
        const venueInchargeMap = {};
        roleAssignments.forEach(ra => {
            if (!venueInchargeMap[ra.venue_id]) venueInchargeMap[ra.venue_id] = [];
            venueInchargeMap[ra.venue_id].push(ra.user_id);
        });

        const reportData = tasks.map(t => {
            const tt = t.TaskTypes?.[0];
            const creator = t.Creator;
            const profile = creator?.Student || creator?.Faculty || creator?.Staff || creator?.RoleUser;
            const bookedBy = profile ? profile.name : (creator ? `User #${creator.user_id}` : 'System');
            
            // Find incharge action time/status
            const incharges = venueInchargeMap[t.venue_id || tt?.venue_id] || [];
            const inchargeAssign = t.TaskAssigns?.find(a => incharges.includes(a.user_id));
            const approvalTime = inchargeAssign?.accepted_at ? new Date(inchargeAssign.accepted_at).toLocaleString() : (inchargeAssign?.status || 'N/A');

            // Collect all assignee names
            const assignees = t.TaskAssigns?.map(a => {
                const u = a.User;
                const p = u?.Student || u?.Faculty || u?.Staff || u?.RoleUser;
                return p ? p.name : `User #${a.user_id}`;
            }).join(', ') || 'None';

            // Calculate duration
            let durationMin = 0;
            if (tt?.start_time && tt?.end_time) {
                const [sH, sM] = tt.start_time.split(':').map(Number);
                const [eH, eM] = tt.end_time.split(':').map(Number);
                durationMin = (eH * 60 + eM) - (sH * 60 + sM);
            }

            return {
                "Date": tt?.start_date ? new Date(tt.start_date).toISOString().split('T')[0] : 'N/A',
                "Venue": t.Venue?.name || "N/A",
                "Venue Type": t.Venue?.venue_type || "N/A",
                "Location": t.Venue?.location || "N/A",
                "Task Title": t.title,
                "Category": t.category,
                "Priority": t.priority,
                "Origin": t.origin_type || 'directive',
                "Status": t.status,
                "Booked By": bookedBy,
                "Start Time": tt?.start_time || 'N/A',
                "End Time": tt?.end_time || 'N/A',
                "Duration (Min)": durationMin > 0 ? durationMin : 0,
                "Score": parseFloat(t.score || 0).toFixed(2),
                "Penalty/Hr": parseFloat(t.penalty_per_hour || 0).toFixed(2),
                "Mandatory": t.is_mandatory ? 'Yes' : 'No',
                "Resource Used": t.Resource?.name || 'None',
                "Total Assignees": t.TaskAssigns?.length || 0,
                "Assignee Names": assignees,
                "Incharge Status": inchargeAssign?.status || 'Pending',
                "Action Taken At": approvalTime
            };
        });

        // 5. Generate Aggregate Summary Data
        const summaryData = assignedVenueIds.map(vid => {
            const vTasks = tasks.filter(t => t.venue_id === vid || t.TaskTypes?.some(tt => tt.venue_id === vid));
            if (vTasks.length === 0) return null;

            const vName = vTasks[0].Venue?.name || "Venue "+vid;
            const totalTasks = vTasks.length;
            const totalMinForVenue = reportData.filter(r => r.Venue === vName).reduce((acc, curr) => acc + (parseFloat(curr["Duration (Min)"]) || 0), 0);
            
            return {
                "Venue ID": vid,
                "Venue Name": vName,
                "Total Usage Events": totalTasks,
                "Cumulative Duration (Min)": totalMinForVenue.toFixed(2),
                "Avg Duration/Event": totalTasks > 0 ? (totalMinForVenue / totalTasks).toFixed(2) : 0
            };
        }).filter(Boolean);

        // 6. Generate Excel
        const wb = xlsx.utils.book_new();
        const wsDetailed = xlsx.utils.json_to_sheet(reportData);
        const wsSummary = xlsx.utils.json_to_sheet(summaryData);
        
        xlsx.utils.book_append_sheet(wb, wsDetailed, "Usage History");
        xlsx.utils.book_append_sheet(wb, wsSummary, "Venue Summary");
        
        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=venue_utilization_${fromStr}_to_${toStr}.xlsx`);
        res.send(buffer);

    } catch (error) {
        console.error('MASTER EXPORT ERROR:', error);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/venues/export
// Exports venue utilization metrics to Excel with score and penalty data
// ─────────────────────────────────────────────────────────────────────────────
exports.exportVenueUtilisation = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole?.toLowerCase();

        // 1. Determine which venues to include
        let assignedVenueIds = [];
        if (userRole === 'admin') {
            const all = await Venue.findAll({ attributes: ['venue_id'] });
            assignedVenueIds = all.map(v => v.venue_id);
        } else {
            const assignments = await RoleAssignment.findAll({
                where: { user_id: userId, venue_id: { [Op.ne]: null } },
                attributes: ['venue_id']
            });
            assignedVenueIds = [...new Set(assignments.map(a => a.venue_id))];
        }

        if (assignedVenueIds.length === 0) {
            return res.status(404).json({ message: "No venues found for report export." });
        }

        // 2. Fetch Venues with Tasks, Incharges and Resources
        const venues = await Venue.findAll({
            where: { venue_id: { [Op.in]: assignedVenueIds } },
            include: [
                {
                    model: RoleAssignment,
                    include: [{
                        model: User,
                        attributes: ['user_id'],
                        include: [
                            { model: Student, attributes: ['name'], required: false },
                            { model: Faculty, attributes: ['name'], required: false },
                            { model: Staff, attributes: ['name'], required: false },
                            { model: RoleUser, attributes: ['name'], required: false }
                        ]
                    }]
                }
            ]
        });

        const reportData = [];

        for (const venue of venues) {
            const tasks = await Task.findAll({
                where: { 
                    is_deleted: false,
                    [Op.or]: [
                        { venue_id: venue.venue_id },
                        literal(`\`Task\`.\`task_id\` IN (SELECT task_id FROM task_types WHERE venue_id = ${venue.venue_id})`)
                    ]
                }
            });

            const acceptedTasks = await Task.findAll({
                where: { 
                    is_deleted: false,
                    [Op.or]: [
                        { venue_id: venue.venue_id },
                        literal(`\`Task\`.\`task_id\` IN (SELECT task_id FROM task_types WHERE venue_id = ${venue.venue_id})`)
                    ]
                },
                include: [{
                    model: TaskAssign,
                    where: { status: 'accepted' },
                    required: true
                }, {
                    model: TaskType,
                    required: true
                }]
            });

            // Cumulative Metrics
            const totalScore = tasks.reduce((acc, t) => acc + parseFloat(t.score || 0), 0);
            const totalPenalty = tasks.reduce((acc, t) => acc + parseFloat(t.penalty_per_hour || 0), 0);
            
            const resourceCount = await require('../models').Resource.count({
                where: { venue_id: venue.venue_id }
            });

            let totalMinutes = 0;
            acceptedTasks.forEach(t => {
                const tt = t.TaskTypes?.[0];
                if (tt && tt.start_time && tt.end_time) {
                    const [sH, sM] = tt.start_time.split(':').map(Number);
                    const [eH, eM] = tt.end_time.split(':').map(Number);
                    const duration = (eH * 60 + eM) - (sH * 60 + sM);
                    if (duration > 0) totalMinutes += duration;
                }
            });

            const incharges = (venue.RoleAssignments || []).map(ra => {
                const u = ra.User;
                if (!u) return null;
                const p = u.Student || u.Faculty || u.Staff || u.RoleUser;
                return p ? p.name : `User #${u.user_id}`;
            }).filter(Boolean).join(', ');

            const operationalWindow = 480; 
            const utilization = ((totalMinutes / operationalWindow) * 100).toFixed(2);

            reportData.push({
                "Venue Name": venue.name,
                "Type": venue.venue_type,
                "Location": venue.location,
                "Status": venue.status || 'open',
                "Total Bookings": tasks.length,
                "Confirmed Bookings": acceptedTasks.length,
                "Total Resources": resourceCount,
                "Accumulated Score": totalScore.toFixed(2),
                "Total Penalty": totalPenalty.toFixed(2),
                "Utilization % (Current Load)": `${utilization}%`,
                "Incharge": incharges || "N/A"
            });
        }

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(reportData);
        xlsx.utils.book_append_sheet(wb, ws, "Venue Utilisation");

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=venue_utilisation_summary.xlsx');
        res.send(buffer);

    } catch (error) {
        console.error('UTILISATION EXPORT ERROR:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;
