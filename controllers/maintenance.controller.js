'use strict';
const { MaintenanceLog, Venue, Resource, ResourceUsageLog, User, Task, TaskType, TaskAssign, RoleAssignment } = require('../models');
const { Op, literal } = require('sequelize');

// Helper: format YYYY-MM-DD
function toDateStr(dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
}

// 1. Maintenance Log APIs

exports.addMaintenanceLog = async (req, res) => {
    const t = await MaintenanceLog.sequelize.transaction();
    try {
        const {
            venue_id,
            resource_id,
            category,
            cost,
            description,
            location,
            issue_title,
            status,
            start_time,
            end_time
        } = req.body;

        const userId = req.userId;
        const userRole = req.userRole;

        // Authorization Check: Only Admin or the assigned Venue Incharge can create logs
        if (userRole !== 'admin' && userRole !== 'ADMIN') {
            const hasAssignment = await RoleAssignment.findOne({
                where: {
                    user_id: userId,
                    venue_id: venue_id
                }
            });

            if (!hasAssignment) {
                await t.rollback();
                return res.status(403).json({ message: 'Unauthorized: You are not assigned to this venue.' });
            }
        }

        const log = await MaintenanceLog.create({
            venue_id,
            resource_id,
            category,
            cost,
            description,
            location,
            issue_title,
            status: status || 'pending',
            start_time,
            end_time
        }, { transaction: t });

        // Update Venue/Resource status if status is 'in_progress' or 'pending'
        if (status === 'in_progress' || status === 'pending') {
            if (resource_id) {
                await Resource.update({ status: 'under maintenance' }, { where: { resource_id }, transaction: t });
            } else if (venue_id) {
                await Venue.update({ status: 'under maintenance' }, { where: { venue_id }, transaction: t });
            }
        } else if (status === 'completed' || status === 'cancelled') {
            if (resource_id) {
                await Resource.update({ status: 'available' }, { where: { resource_id }, transaction: t });
            } else if (venue_id) {
                await Venue.update({ status: 'open' }, { where: { venue_id }, transaction: t });
            }
        }

        await t.commit();
        res.status(201).json({ message: 'Maintenance log added successfully', log });
    } catch (error) {
        await t.rollback();
        console.error('Error in addMaintenanceLog:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.updateMaintenanceLog = async (req, res) => {
    const t = await MaintenanceLog.sequelize.transaction();
    try {
        const { id } = req.params;
        const updateData = req.body;

        const log = await MaintenanceLog.findByPk(id);
        if (!log) {
            await t.rollback();
            return res.status(404).json({ message: 'Maintenance log not found' });
        }

        await log.update(updateData, { transaction: t });

        // Sync Venue/Resource status
        if (updateData.status) {
            if (updateData.status === 'completed' || updateData.status === 'cancelled') {
                if (log.resource_id) {
                    await Resource.update({ status: 'available' }, { where: { resource_id: log.resource_id }, transaction: t });
                } else if (log.venue_id) {
                    await Venue.update({ status: 'open' }, { where: { venue_id: log.venue_id }, transaction: t });
                }
            } else if (updateData.status === 'in_progress') {
                if (log.resource_id) {
                    await Resource.update({ status: 'under maintenance' }, { where: { resource_id: log.resource_id }, transaction: t });
                } else if (log.venue_id) {
                    await Venue.update({ status: 'under maintenance' }, { where: { venue_id: log.venue_id }, transaction: t });
                }
            }
        }

        await t.commit();
        res.json({ message: 'Maintenance log updated successfully', log });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.deleteMaintenanceLog = async (req, res) => {
    try {
        const { id } = req.params;
        const log = await MaintenanceLog.findByPk(id);
        if (!log) return res.status(404).json({ message: 'Log not found' });

        await log.destroy();
        res.json({ message: 'Maintenance log deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getMaintenanceLogs = async (req, res) => {
    try {
        const { venue_id, resource_id, date } = req.query;
        const userId = req.userId;
        const userRole = req.role; // Assuming verifyToken populates this

        const where = {};
        
        // 1. Authorization Filter: If not Admin, only show venues user manages
        if (userRole !== 'admin') {
            const RoleAssignment = require('../models/role_assignment'); // Ensure model is available
            const assignments = await RoleAssignment.findAll({
                where: { user_id: userId, venue_id: { [Op.ne]: null } },
                attributes: ['venue_id']
            });
            const managedVenueIds = assignments.map(a => a.venue_id);

            if (managedVenueIds.length === 0) {
                return res.json({ success: true, logs: [], message: 'No managed venues found for this user.' });
            }

            // Filter for these venues
            if (venue_id) {
                if (!managedVenueIds.includes(parseInt(venue_id))) {
                    return res.status(403).json({ message: 'Forbidden: You do not manage this venue.' });
                }
                where.venue_id = venue_id;
            } else {
                // If no specific venue requested, show all managed venues (and their resources)
                const resources = await Resource.findAll({
                    where: { venue_id: { [Op.in]: managedVenueIds } },
                    attributes: ['resource_id']
                });
                const managedResourceIds = resources.map(r => r.resource_id);

                where[Op.or] = [
                    { venue_id: { [Op.in]: managedVenueIds } },
                    { resource_id: { [Op.in]: managedResourceIds } }
                ];
            }
        } else {
            // Admin can see everything, or filter by specific venue/resource
            if (venue_id) where.venue_id = venue_id;
            if (resource_id) where.resource_id = resource_id;
        }

        // 2. Date Filter
        if (date) {
            const startOfDate = new Date(date);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(date);
            endOfDate.setHours(23, 59, 59, 999);

            where[Op.or] = [
                // Created on this date
                {
                    created_at: {
                        [Op.between]: [startOfDate, endOfDate]
                    }
                },
                // OR Active during this date (start_time <= end and end_time >= start)
                {
                    [Op.and]: [
                        { start_time: { [Op.lte]: endOfDate } },
                        { 
                            [Op.or]: [
                                { end_time: null },
                                { end_time: { [Op.gte]: startOfDate } }
                            ]
                        }
                    ]
                }
            ];
        }

        const logs = await MaintenanceLog.findAll({
            where,
            include: [
                { model: Venue, attributes: ['name'] },
                { model: Resource, attributes: ['name'] }
            ],
            order: [['created_at', 'DESC']]
        });

        res.json({ success: true, logs });
    } catch (error) {
        console.error('Error in getMaintenanceLogs:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Fetch logs specifically for a Venue (including its resources)
exports.getMaintenanceLogsByVenue = async (req, res) => {
    try {
        const { venueId } = req.params;
        const userId = req.userId;
        const userRole = req.role;

        // Authorization: Check if user manages this venue (if not admin)
        if (userRole !== 'admin') {
            const RoleAssignment = require('../models/role_assignment');
            const assignment = await RoleAssignment.findOne({
                where: { user_id: userId, venue_id: venueId }
            });
            if (!assignment) {
                return res.status(403).json({ message: 'Forbidden: You do not manage this venue.' });
            }
        }

        // 1. Get all resource IDs for this venue
        const resources = await Resource.findAll({
            where: { venue_id: venueId },
            attributes: ['resource_id']
        });
        const resourceIds = resources.map(r => r.resource_id);

        // 2. Fetch logs that match EITHER the venue directly OR one of its resources
        const logs = await MaintenanceLog.findAll({
            where: {
                [Op.or]: [
                    { venue_id: venueId },
                    { resource_id: { [Op.in]: resourceIds } }
                ]
            },
            include: [
                { model: Venue, attributes: ['name'] },
                { model: Resource, attributes: ['name'] }
            ],
            order: [['created_at', 'DESC']]
        });

        res.json({ success: true, venue_id: venueId, total: logs.length, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Resource Usage APIs (QR + OTP)

exports.startResourceUsage = async (req, res) => {
    try {
        const { resource_id, venue_id } = req.body;
        const user_id = req.userId;

        // 1. Check if venue is allotted to this user for today
        // This usually means the user has an 'accepted' task at this venue right now
        const now = new Date();
        const dateStr = toDateStr(now);
        const currentTime = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM

        const activeAssignment = await TaskAssign.findOne({
            where: {
                user_id,
                status: 'accepted'
            },
            include: [{
                model: Task,
                where: { venue_id },
                required: true,
                include: [{
                    model: TaskType,
                    where: {
                        [Op.and]: [
                            literal(`DATE(start_date) <= '${dateStr}'`),
                            literal(`DATE(end_date) >= '${dateStr}'`),
                            { start_time: { [Op.lte]: currentTime } },
                            { end_time: { [Op.gte]: currentTime } }
                        ]
                    }
                }]
            }]
        });

        if (!activeAssignment) {
            return res.status(403).json({ message: 'Venue not allotted to you at this time.' });
        }

        // 2. Generate Start OTP
        const start_otp = Math.floor(100000 + Math.random() * 900000).toString();

        // 3. Create Usage Log
        const usage = await ResourceUsageLog.create({
            resource_id,
            user_id,
            venue_id,
            start_time: now,
            start_otp,
            is_verified: false
        });

        res.json({
            message: 'Usage initialized. Please enter the OTP to verify.',
            usage_id: usage.usage_id,
            otp: start_otp // In real case, send via SMS/Email or show on screen
        });

    } catch (error) {
        console.error('Error in startResourceUsage:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.verifyStartOtp = async (req, res) => {
    try {
        const { usage_id, otp } = req.body;
        const usage = await ResourceUsageLog.findByPk(usage_id);

        if (!usage) return res.status(404).json({ message: 'Usage record not found' });
        if (usage.start_otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });

        await usage.update({ is_verified: true });
        res.json({ message: 'Usage verified successfully', usage });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.endResourceUsage = async (req, res) => {
    try {
        const { usage_id } = req.body;
        const usage = await ResourceUsageLog.findByPk(usage_id);

        if (!usage) return res.status(404).json({ message: 'Usage record not found' });

        const end_otp = Math.floor(100000 + Math.random() * 900000).toString();
        await usage.update({ end_otp });

        res.json({ message: 'End OTP generated', otp: end_otp });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.verifyEndOtp = async (req, res) => {
    try {
        const { usage_id, otp } = req.body;
        const usage = await ResourceUsageLog.findByPk(usage_id);

        if (!usage) return res.status(404).json({ message: 'Usage record not found' });
        if (usage.end_otp !== otp) return res.status(400).json({ message: 'Invalid OTP' });

        await usage.update({ end_time: new Date() });
        res.json({ message: 'Usage concluded successfully', usage });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. Venue Status and Full Day Booking logic

exports.getVenueExtendedDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const date = req.query.date || toDateStr(new Date());

        const venue = await Venue.findByPk(id, {
            include: [
                { model: Resource, attributes: ['resource_id', 'name', 'status'] },
                { model: MaintenanceLog, limit: 5, order: [['created_at', 'DESC']] }
            ]
        });

        if (!venue) return res.status(404).json({ message: 'Venue not found' });

        // Full Day Booking Logic (8:45 to 16:30)
        // We check all 'accepted' tasks for this venue on this date
        const todaysTasks = await Task.findAll({
            where: { is_deleted: false },
            include: [{
                model: TaskType,
                required: true,
                where: {
                    [Op.and]: [
                        { [Op.or]: [{ venue_id: id }, literal(`\`Task\`.\`venue_id\` = ${id}`)] },
                        literal(`DATE(start_date) <= '${date}'`),
                        literal(`DATE(end_date) >= '${date}'`)
                    ]
                }
            }, {
                model: TaskAssign,
                where: { status: 'accepted' },
                required: true
            }]
        });

        // Simple overlap logic to see if 08:45-16:30 is covered
        // We can sort slots and check gaps
        const slots = todaysTasks.map(t => {
            const tt = t.TaskTypes[0];
            return { start: tt.start_time, end: tt.end_time };
        }).sort((a, b) => a.start.localeCompare(b.start));

        let isFullDayBooked = false;
        if (slots.length > 0) {
            let currentEnd = "08:45";
            let covered = true;

            if (slots[0].start > "08:45") {
                covered = false;
            } else {
                for (const slot of slots) {
                    if (slot.start > currentEnd) {
                        covered = false;
                        break;
                    }
                    if (slot.end > currentEnd) currentEnd = slot.end;
                }
            }

            if (covered && currentEnd >= "16:30") {
                isFullDayBooked = true;
            }
        }

        const effectiveStatus = isFullDayBooked ? 'full day booked' : venue.status;

        res.json({
            venue_id: venue.venue_id,
            name: venue.name,
            status: effectiveStatus,
            is_full_day_booked: isFullDayBooked,
            resources: venue.Resources,
            maintenance_history: venue.MaintenanceLogs,
            booking_coverage: slots
        });

    } catch (error) {
        console.error('Error in getVenueExtendedDetails:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getUsageLogs = async (req, res) => {
    try {
        const { venue_id, resource_id, user_id } = req.query;
        const where = {};
        if (venue_id) where.venue_id = venue_id;
        if (resource_id) where.resource_id = resource_id;
        if (user_id) where.user_id = user_id;

        const logs = await ResourceUsageLog.findAll({
            where,
            include: [
                { model: Resource, attributes: ['name'] },
                { model: Venue, attributes: ['name'] },
                { model: User, attributes: ['user_id', 'role'] }
            ],
            order: [['start_time', 'DESC']]
        });

        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. Advanced Venue & Resource Analytics

/**
 * Fetch 2-day venue status history (status with date, maintenance times if any).
 */
exports.getVenueStatusHistory = async (req, res) => {
    try {
        const { id } = req.params;
        const venue = await Venue.findByPk(id);
        if (!venue) return res.status(404).json({ message: 'Venue not found' });

        const history = [];
        const today = new Date();

        for (let i = 0; i < 2; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = toDateStr(date);

            // Fetch maintenance logs for this date
            const maintenanceLogs = await MaintenanceLog.findAll({
                where: {
                    venue_id: id,
                    [Op.or]: [
                        literal(`DATE(start_time) = '${dateStr}'`),
                        literal(`DATE(end_time) = '${dateStr}'`),
                        {
                            [Op.and]: [
                                { start_time: { [Op.lte]: dateStr } },
                                { end_time: { [Op.gte]: dateStr } }
                            ]
                        }
                    ]
                }
            });

            // Check Full Day Booking for this day
            const bookings = await Task.findAll({
                where: { is_deleted: false },
                include: [{
                    model: TaskType,
                    required: true,
                    where: {
                        [Op.and]: [
                            { [Op.or]: [{ venue_id: id }, literal(`\`Task\`.\`venue_id\` = ${id}`)] },
                            literal(`DATE(start_date) <= '${dateStr}'`),
                            literal(`DATE(end_date) >= '${dateStr}'`)
                        ]
                    }
                }, {
                    model: TaskAssign,
                    where: { status: 'accepted' },
                    required: true
                }]
            });

            const slots = bookings.map(t => {
                const tt = t.TaskTypes[0];
                return { start: tt.start_time, end: tt.end_time };
            }).sort((a, b) => a.start.localeCompare(b.start));

            let isFullDayBooked = false;
            if (slots.length > 0) {
                let currentEnd = "08:45";
                let covered = true;
                if (slots[0].start > "08:45") covered = false;
                else {
                    for (const slot of slots) {
                        if (slot.start > currentEnd) {
                            covered = false;
                            break;
                        }
                        if (slot.end > currentEnd) currentEnd = slot.end;
                    }
                }
                if (covered && currentEnd >= "16:30") isFullDayBooked = true;
            }

            // Determine Status
            let status = venue.status; // Default
            if (maintenanceLogs.some(l => l.status === 'in_progress')) status = 'under maintenance';
            else if (isFullDayBooked) status = 'full day booked';
            else if (bookings.length > 0) status = 'partially booked';
            else status = 'open';

            history.push({
                date: dateStr,
                status: status,
                maintenance_activities: maintenanceLogs.map(l => ({
                    issue: l.issue_title,
                    from: l.start_time,
                    to: l.end_time,
                    status: l.status,
                    category: l.category
                }))
            });
        }

        res.json({
            venue_id: id,
            venue_name: venue.name,
            history: history
        });

    } catch (error) {
        console.error('Error in getVenueStatusHistory:', error);
        res.status(500).json({ message: error.message });
    }
};

/**
 * Fetch detailed resource analytics for a venue.
 * Includes resource list, total available, faulty, in-maintenance counts, and utilization %.
 */
exports.getVenueResourceAnalytics = async (req, res) => {
    try {
        const { id } = req.params;
        const resources = await Resource.findAll({
            where: { venue_id: id }
        });

        if (resources.length === 0) {
            return res.json({
                venue_id: id,
                total_resources: 0,
                available_count: 0,
                maintenance_count: 0,
                faulty_count: 0,
                utilization_percentage: "0.00",
                resources: []
            });
        }

        const counts = {
            available: 0,
            maintenance: 0,
            faulty: 0
        };

        resources.forEach(r => {
            if (r.status === 'available') counts.available++;
            else if (r.status === 'under maintenance') counts.maintenance++;
            else if (['damaged', 'broken'].includes(r.status)) counts.faulty++;
        });

        // Calculate Utilization % for Today
        const dateStr = toDateStr(new Date());
        const usageLogs = await ResourceUsageLog.findAll({
            where: {
                venue_id: id,
                [Op.or]: [
                    literal(`DATE(start_time) = '${dateStr}'`),
                    literal(`DATE(end_time) = '${dateStr}'`)
                ]
            }
        });

        let totalMinutesUsed = 0;
        const now = new Date();

        usageLogs.forEach(log => {
            const start = new Date(Math.max(new Date(log.start_time), new Date(dateStr + " 00:00:00")));
            const endTime = log.end_time ? new Date(log.end_time) : now;
            const end = new Date(Math.min(endTime, new Date(dateStr + " 23:59:59")));

            const diff = (end - start) / (1000 * 60);
            if (diff > 0) totalMinutesUsed += diff;
        });

        // 8:45 to 16:30 is 7 hours 45 minutes = 465 minutes
        const operationalMinutesPerResource = 465;
        const totalPotentialCapacity = resources.length * operationalMinutesPerResource;
        const utilizationPercentage = (totalMinutesUsed / totalPotentialCapacity) * 100;

        res.json({
            venue_id: id,
            total_resources: resources.length,
            available_count: counts.available,
            maintenance_count: counts.maintenance,
            faulty_count: counts.faulty,
            utilization_percentage: Math.min(utilizationPercentage, 100).toFixed(2),
            resources: resources
        });

    } catch (error) {
        console.error('Error in getVenueResourceAnalytics:', error);
        res.status(500).json({ message: error.message });
    }
};
