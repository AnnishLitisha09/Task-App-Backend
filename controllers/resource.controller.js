const { Department, Venue, RoleAssignment, User, RoleUser, Role, Resource, Faculty, Staff, Scope } = require('../models');
const { Op, Sequelize } = require('sequelize');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

exports.getAllDepartments = async (req, res) => {
    try {
        const departments = await Department.findAll({
            include: [{
                model: RoleAssignment,
                include: [
                    {
                        model: Role,
                        where: { user_role: 'HOD' },
                        required: false
                    },
                    {
                        model: User,
                        required: false,
                        include: [{ model: RoleUser, attributes: ['name', 'email'] }]
                    }
                ],
                required: false
            }]
        });

        const formatted = departments.map(dept => {
            const assignment = dept.RoleAssignments && dept.RoleAssignments.find(ra => ra.Role && ra.Role.user_role === 'HOD');
            return {
                department_id: dept.department_id,
                name: dept.name,
                created_at: dept.created_at,
                hod: assignment && assignment.User && assignment.User.RoleUser ? {
                    user_id: assignment.User.user_id,
                    name: assignment.User.RoleUser.name,
                    email: assignment.User.RoleUser.email
                } : null
            };
        });

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.addDepartment = async (req, res) => {
    const t = await Department.sequelize.transaction();
    try {
        const { name, user_id } = req.body;
        if (!name) {
            await t.rollback();
            return res.status(400).json({ message: 'Department name is required' });
        }

        const dept = await Department.create({ name }, { transaction: t });

        if (user_id) {
            const user = await User.findByPk(user_id);
            if (!user) {
                await t.rollback();
                return res.status(404).json({ message: 'User not found' });
            }

            const hodRole = await Role.findOne({ where: { user_role: 'HOD' } });
            if (!hodRole) {
                await t.rollback();
                return res.status(404).json({ message: 'HOD role not found' });
            }

            await RoleAssignment.create({
                user_id,
                role_id: hodRole.role_id,
                department_id: dept.department_id,
                created_at: new Date(),
                updated_at: new Date()
            }, { transaction: t });
        }

        await t.commit();
        res.status(201).json({
            message: 'Department created successfully',
            department_id: dept.department_id
        });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.updateDepartment = async (req, res) => {
    const t = await Department.sequelize.transaction();
    try {
        const { id } = req.params;
        const { name, user_id } = req.body;

        const dept = await Department.findByPk(id);
        if (!dept) {
            await t.rollback();
            return res.status(404).json({ message: 'Department not found' });
        }

        // Update name if provided
        await dept.update({ name: name || dept.name }, { transaction: t });

        // Handle HOD assignment if user_id is provided
        if (user_id) {
            const user = await User.findByPk(user_id);
            if (!user) {
                await t.rollback();
                return res.status(404).json({ message: 'User not found' });
            }

            const hodRole = await Role.findOne({ where: { user_role: 'HOD' } });
            if (!hodRole) {
                await t.rollback();
                return res.status(404).json({ message: 'HOD role not found in system' });
            }

            // 1. Remove any existing HOD assignment for THIS department
            await RoleAssignment.destroy({
                where: {
                    department_id: id,
                    role_id: hodRole.role_id
                },
                transaction: t
            });

            // 2. Create new HOD assignment
            await RoleAssignment.create({
                user_id,
                role_id: hodRole.role_id,
                department_id: id,
                created_at: new Date(),
                updated_at: new Date()
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: 'Department updated successfully' });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.deleteDepartment = async (req, res) => {
    const t = await Department.sequelize.transaction();
    try {
        const { id } = req.params;
        const dept = await Department.findByPk(id);
        if (!dept) {
            await t.rollback();
            return res.status(404).json({ message: 'Department not found' });
        }

        // 1. Manually nullify references because soft delete doesn't trigger DB-level SET NULL
        await Faculty.update({ department_id: null }, { where: { department_id: id }, transaction: t });
        await Student.update({ department_id: null }, { where: { department_id: id }, transaction: t });
        await RoleAssignment.update({ department_id: null }, { where: { department_id: id }, transaction: t });

        // 2. Soft delete the department
        await dept.destroy({ transaction: t });
        
        await t.commit();
        res.json({ message: 'Department deleted successfully' });
    } catch (error) {
        if (t) await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.getUnassignedHODs = async (req, res) => {
    try {
        // Fetch all users with profile 'role-user' who don't have an 'HOD' role assignment
        const unassigned = await RoleUser.findAll({
            include: [{
                model: User,
                required: true,
                include: [{
                    model: RoleAssignment,
                    include: [Role],
                    required: false
                }]
            }]
        });

        // Filter for those who don't have HOD role assignment
        const filtered = unassigned.filter(ru => {
            const hasHodRole = ru.User?.RoleAssignments?.some(ra => ra.Role?.user_role === 'HOD');
            return !hasHodRole;
        });

        res.json(filtered.map(ru => ({
            user_id: ru.user_id,
            name: ru.name,
            email: ru.email
        })));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllVenues = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;

        const venues = await Venue.findAll({
            include: [
                {
                    model: RoleAssignment,
                    required: (userRole !== 'admin' && userRole !== 'ADMIN'), 
                    where: (userRole !== 'admin' && userRole !== 'ADMIN') ? { user_id: userId } : {},
                    include: [
                        {
                            model: User,
                            attributes: ['user_id', 'role', 'status'],
                            include: [
                                { model: RoleUser, attributes: ['name', 'email', 'score', 'penalty'] },
                                { model: Faculty, attributes: ['name', 'email', 'score', 'penalty'] },
                                { model: Staff, attributes: ['name', 'email', 'score', 'penalty'] }
                            ]
                        },
                        {
                            model: Role,
                            attributes: ['user_role']
                        }
                    ]
                },
                {
                    model: Resource,
                    required: false,
                    where: { deleted_at: null }
                }
            ],
            order: [['venue_id', 'ASC']]
        });

        // Format response to include incharge details and resource details
        const formattedVenues = venues.map(venue => {
            const venueData = {
                venue_id: venue.venue_id,
                name: venue.name,
                venue_type: venue.venue_type,
                location: venue.location,
                description: venue.description,
                image_url: venue.image_url,
                created_at: venue.created_at,
                incharge: null,
                total_resource_count: venue.Resources ? venue.Resources.reduce((acc, r) => acc + (r.quantity || 0), 0) : 0,
                available_resources: venue.Resources ? venue.Resources.filter(r => r.status === 'available').map(r => ({
                    resource_id: r.resource_id,
                    name: r.name,
                    quantity: r.quantity,
                    status: r.status
                })) : []
            };

            // Check if there's an assigned incharge
            if (venue.RoleAssignments && venue.RoleAssignments.length > 0) {
                const assignment = venue.RoleAssignments[0]; // Get first assignment
                if (assignment.User) {
                    const profile = assignment.User.RoleUser || assignment.User.Faculty || assignment.User.Staff;
                    if (profile) {
                        venueData.incharge = {
                            user_id: assignment.User.user_id,
                            name: profile.name,
                            email: profile.email,
                            role: assignment.Role?.user_role || 'Incharge',
                            score: profile.score,
                            penalty: profile.penalty
                        };
                    }
                }
            }

            return venueData;
        });

        res.json(formattedVenues);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getMyVenue = async (req, res) => {
    try {
        const userId = req.userId;
        const assignment = await RoleAssignment.findOne({
            where: { user_id: userId, venue_id: { [Op.not]: null } }
        });

        if (!assignment) {
            return res.json(null); // Return null instead of 404 so frontend can handle gracefully
        }

        const venueId = assignment.venue_id;

        const venue = await Venue.findByPk(venueId, {
            include: [
                {
                    model: RoleAssignment,
                    required: false,
                    include: [
                        {
                            model: User,
                            attributes: ['user_id', 'role', 'status'],
                            include: [
                                { model: RoleUser, attributes: ['name', 'email', 'score', 'penalty'] },
                                { model: Faculty, attributes: ['name', 'email', 'score', 'penalty'] },
                                { model: Staff, attributes: ['name', 'email', 'score', 'penalty'] }
                            ]
                        },
                        {
                            model: Role,
                            attributes: ['user_role']
                        }
                    ]
                },
                {
                    model: Resource,
                    required: false,
                    where: { deleted_at: null }
                }
            ]
        });

        if (!venue) {
            return res.json(null);
        }

        // Format
        const venueData = {
            venue_id: venue.venue_id,
            name: venue.name,
            venue_type: venue.venue_type,
            location: venue.location,
            description: venue.description,
            image_url: venue.image_url,
            created_at: venue.created_at,
            current_status: venue.status || 'open',
            incharge: null,
            all_resources: venue.Resources ? venue.Resources.map(r => ({
                resource_id: r.resource_id,
                name: r.name,
                quantity: r.quantity,
                status: r.status,
                description: r.description
            })) : [],
            grouped_resources: (() => {
                const grouped = {};
                (venue.Resources || []).forEach(r => {
                    if (!grouped[r.name]) {
                        grouped[r.name] = {
                            name: r.name,
                            description: r.description,
                            total_quantity: 0,
                            items: []
                        };
                    }
                    grouped[r.name].total_quantity += (r.quantity || 0);
                    grouped[r.name].items.push({
                        resource_id: r.resource_id,
                        status: r.status,
                        quantity: r.quantity
                    });
                });
                return Object.values(grouped);
            })()
        };

        if (venue.RoleAssignments && venue.RoleAssignments.length > 0) {
            const roleAssignment = venue.RoleAssignments[0];
            if (roleAssignment.User) {
                const profile = roleAssignment.User.RoleUser || roleAssignment.User.Faculty || roleAssignment.User.Staff;
                if (profile) {
                    venueData.incharge = {
                        user_id: roleAssignment.User.user_id,
                        name: profile.name,
                        email: profile.email,
                        role: roleAssignment.Role?.user_role || 'Incharge',
                        score: profile.score,
                        penalty: profile.penalty
                    };
                }
            }
        }

        res.json(venueData);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Fetch incharge (Role User) for a specific venue
exports.getVenueIncharge = async (req, res) => {
    try {
        const { venueId } = req.params;

        const assignment = await RoleAssignment.findOne({
            where: { venue_id: venueId },
            include: [
                {
                    model: User,
                    attributes: ['user_id', 'role', 'status'],
                    include: [
                        { model: RoleUser, attributes: ['name', 'email', 'score', 'penalty'] },
                        { model: Faculty, attributes: ['name', 'email', 'score', 'penalty'] },
                        { model: Staff, attributes: ['name', 'email', 'score', 'penalty'] }
                    ]
                },
                {
                    model: Role,
                    attributes: ['user_role']
                }
            ]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'No incharge found for this venue' });
        }

        let profile = null;
        if (assignment.User) {
            profile = assignment.User.RoleUser || assignment.User.Faculty || assignment.User.Staff;
        }

        res.json({
            role: assignment.Role ? assignment.Role.user_role : 'Unknown',
            category: assignment.User ? assignment.User.role : 'Unknown',
            user: profile ? {
                user_id: assignment.User.user_id,
                name: profile.name,
                email: profile.email,
                score: profile.score,
                penalty: profile.penalty
            } : assignment.User
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// Add Venue
exports.addVenue = async (req, res) => {
    const t = await Venue.sequelize.transaction();
    try {
        const { name, venue_type, location, description, user_id, role_name, department_id } = req.body;
        const image_url = req.file ? `/uploads/venues/${req.file.filename}` : null;

        if (!name) {
            await t.rollback();
            return res.status(400).json({ message: 'Venue name is required' });
        }

        const venue = await Venue.create({
            name,
            venue_type: venue_type || 'others',
            location,
            description,
            image_url
        }, { transaction: t });

        // If incharge info is provided, assign immediately
        if (user_id && role_name) {
            const user = await User.findByPk(user_id);
            if (!user) {
                await t.rollback();
                return res.status(404).json({ message: 'Incharge user not found' });
            }

            let role = await Role.findOne({ where: { user_role: role_name } });

            // --- Fallback Logic: If specific role not found, find any 'INCHARGE' role ---
            if (!role) {
                role = await Role.findOne({ 
                    where: { user_role: { [Op.like]: '%INCHARGE%' } } 
                });
            }

            if (!role) {
                await t.rollback();
                return res.status(404).json({ message: `Role '${role_name}' and generic 'INCHARGE' role not found` });
            }

            await RoleAssignment.create({
                user_id,
                role_id: role.role_id,
                venue_id: venue.id,
                department_id: department_id || null, // Optional for venues
                created_at: new Date(),
                updated_at: new Date()
            }, { transaction: t });
        }

        await t.commit();
        res.status(201).json({ message: 'Venue created successfully', venue });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Update Venue
exports.updateVenue = async (req, res) => {
    const t = await Venue.sequelize.transaction();
    try {
        const { id } = req.params;
        const { name, venue_type, location, description, user_id, role_name, department_id } = req.body;

        const venue = await Venue.findByPk(id);
        if (!venue) {
            await t.rollback();
            return res.status(404).json({ message: 'Venue not found' });
        }

        const updateData = {
            name: name || venue.name,
            venue_type: venue_type || venue.venue_type,
            location: location || venue.location,
            description: description !== undefined ? description : venue.description
        };

        if (req.file) {
            // Delete old image if exists
            if (venue.image_url) {
                const oldPath = path.join(__dirname, '..', venue.image_url);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            updateData.image_url = `/uploads/venues/${req.file.filename}`;
        }

        await venue.update(updateData, { transaction: t });

        // If incharge data is provided, update RoleAssignment
        if (user_id && role_name) {
            const user = await User.findByPk(user_id);
            if (!user) {
                await t.rollback();
                return res.status(404).json({ message: 'Incharge user not found' });
            }

            let role = await Role.findOne({ where: { user_role: role_name } });
            
            // --- Fallback Logic: If specific role not found, find any 'INCHARGE' role ---
            if (!role) {
                role = await Role.findOne({ 
                    where: { user_role: { [Op.like]: '%INCHARGE%' } } 
                });
            }

            if (!role) {
                await t.rollback();
                return res.status(404).json({ message: `Role '${role_name}' and generic 'INCHARGE' role not found` });
            }

            // Remove any existing assignments for this venue
            await RoleAssignment.destroy({ where: { venue_id: id }, transaction: t });

            // Create new assignment
            await RoleAssignment.create({
                user_id,
                role_id: role.role_id,
                venue_id: id,
                department_id: department_id || null, // Default to null for incharges
                created_at: new Date(),
                updated_at: new Date()
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: 'Venue updated successfully', venue });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// Delete Venue
exports.deleteVenue = async (req, res) => {
    const t = await Venue.sequelize.transaction();
    try {
        const { id } = req.params;
        const venue = await Venue.findByPk(id);
        if (!venue) {
            await t.rollback();
            return res.status(404).json({ message: 'Venue not found' });
        }

        // Delete image file (even on soft delete, we might want to keep it, but user didn't specify. 
        // Usually file deletion is immediate. Keeping user's existing logic of unlinking.)
        if (venue.image_url) {
            const imagePath = path.join(__dirname, '..', venue.image_url);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        // 1. Manually nullify references
        await RoleAssignment.update({ venue_id: null }, { where: { venue_id: id }, transaction: t });
        await Resource.update({ venue_id: null }, { where: { venue_id: id }, transaction: t });
        await Task.update({ venue_id: null }, { where: { venue_id: id }, transaction: t });
        await TaskType.update({ venue_id: null }, { where: { venue_id: id }, transaction: t });

        // 2. Soft delete the venue
        await venue.destroy({ transaction: t });
        
        await t.commit();
        res.json({ message: 'Venue deleted successfully' });
    } catch (error) {
        if (t) await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// --- Resource CRUD (Master List & Allocation) ---

// Get all resources in the Master List (Inventory)
exports.getMasterResources = async (req, res) => {
    try {
        const resources = await Resource.findAll({
            where: { venue_id: null, deleted_at: null },
            order: [['resource_id', 'ASC']]
        });
        res.json({ success: true, total: resources.length, resources });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Resources assigned to a specific Venue
exports.getResourcesByVenue = async (req, res) => {
    try {
        const { id } = req.params; // Venue ID
        const resources = await Resource.findAll({
            where: { venue_id: id, deleted_at: null },
            order: [['resource_id', 'ASC']]
        });
        res.json({ success: true, count: resources.length, resources });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Add Resource to Master List (Admin Only)
exports.addResource = async (req, res) => {
    try {
        const { name, description, quantity, status } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Resource name is required' });
        }

        const resource = await Resource.create({
            name,
            description,
            venue_id: null, // Master List
            quantity: quantity || 0,
            status: status || 'available'
        });
        res.status(201).json({ success: true, message: 'Resource added to Master List', resource });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Master Resource (Admin Only)
exports.updateResource = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, quantity, status } = req.body;

        const resource = await Resource.findByPk(id);
        if (!resource) {
            return res.status(404).json({ success: false, message: 'Resource not found' });
        }

        await resource.update({
            name: name || resource.name,
            description: description !== undefined ? description : resource.description,
            quantity: quantity !== undefined ? quantity : resource.quantity,
            status: status || resource.status
        });

        res.json({ success: true, message: 'Resource updated successfully', resource });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Resource (Admin Only)
exports.deleteResource = async (req, res) => {
    try {
        const { id } = req.params;
        const resource = await Resource.findByPk(id);
        if (!resource) {
            return res.status(404).json({ success: false, message: 'Resource not found' });
        }

        // Nullify references to this resource in tasks
        await Task.update({ resource_id: null }, { where: { resource_id: id } });

        await resource.destroy(); 
        res.json({ success: true, message: 'Resource deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const removeResourceFromVenue = async (req, res) => {
    const t = await Resource.sequelize.transaction();
    try {
        const { resource_id, quantity } = req.body; // The specific venue resource record ID

        if (!resource_id || !quantity) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'resource_id and quantity are required' });
        }

        const qty = parseInt(quantity);
        if (isNaN(qty) || qty <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid positive quantity is required' });
        }

        // 1. Fetch Venue Resource
        const venueResource = await Resource.findByPk(resource_id, { transaction: t });
        if (!venueResource || !venueResource.venue_id) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Venue resource record not found' });
        }

        if (venueResource.quantity < qty) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Specified quantity exceeds available venue stock' });
        }

        // 2. Fetch Master Resource (by name, since that's how they are linked in the current logic)
        const master = await Resource.findOne({
            where: { name: venueResource.name, venue_id: null },
            transaction: t
        });

        // 3. Update Venue Quantity (or delete if 0)
        if (venueResource.quantity === qty) {
            await venueResource.destroy({ transaction: t });
        } else {
            await venueResource.update({ quantity: venueResource.quantity - qty }, { transaction: t });
        }

        // 4. Update Master Total (Subtracting since it was removed/deleted from the venue)
        if (master) {
            await master.update({ quantity: Math.max(0, master.quantity - qty) }, { transaction: t });
        }

        await t.commit();
        res.json({
            success: true,
            message: `Removed ${qty} ${venueResource.name}(s) from venue and updated global total.`,
            new_venue_quantity: venueResource.quantity - qty
        });

    } catch (error) {
        await t.rollback();
        console.error('DELETION ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.removeResourceFromVenue = removeResourceFromVenue;
exports.assignResourceToVenue = async (req, res) => {
    const t = await Resource.sequelize.transaction();
    try {
        const { master_resource_id, quantity } = req.body;
        const venue_id = req.query['venue-id'] || req.query.venue_id || req.body.venue_id;

        if (!master_resource_id || !venue_id || !quantity) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'master_resource_id, venue_id, and quantity are required' });
        }

        const qty = parseInt(quantity);
        if (isNaN(qty) || qty <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid positive quantity is required' });
        }

        // 1. Fetch Master Resource
        const master = await Resource.findOne({
            where: { resource_id: master_resource_id, venue_id: null },
            transaction: t
        });

        if (!master) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Master Resource not found' });
        }

        // 2. Add to Master (Global Total increases when resources are registered to venues)
        await master.update({ quantity: master.quantity + qty }, { transaction: t });

        // 3. Create/Update Venue Resource
        let venueResource = await Resource.findOne({
            where: { venue_id, name: master.name },
            transaction: t
        });

        if (venueResource) {
            await venueResource.update({ quantity: venueResource.quantity + qty }, { transaction: t });
        } else {
            venueResource = await Resource.create({
                name: master.name,
                description: master.description,
                venue_id: venue_id,
                quantity: qty,
                status: 'available'
            }, { transaction: t });
        }

        await t.commit();
        res.json({
            success: true,
            message: `Allocated ${qty} ${master.name}(s) to venue and updated global total.`,
            total_master_quantity: master.quantity,
            venue_resource: venueResource
        });

    } catch (error) {
        await t.rollback();
        console.error('ALLOCATION ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Assign or Update Venue Incharge
exports.assignVenueIncharge = async (req, res) => {
    const t = await RoleAssignment.sequelize.transaction();
    try {
        const { id } = req.params; // Venue ID
        const { user_id, role_name, department_id } = req.body;

        if (!user_id || !role_name) {
            await t.rollback();
            return res.status(400).json({ message: 'User ID and Role Name are required' });
        }

        const venue = await Venue.findByPk(id);
        if (!venue) {
            await t.rollback();
            return res.status(404).json({ message: 'Venue not found' });
        }

        const user = await User.findByPk(user_id, {
            include: [{ model: Faculty }, { model: Staff }, { model: RoleUser }]
        });
        if (!user) {
            await t.rollback();
            return res.status(404).json({ message: 'User not found' });
        }

        let role = await Role.findOne({
            where: { user_role: role_name },
            include: [{ model: Scope }]
        });

        // --- Fallback Logic: If specific role not found, find any 'INCHARGE' role ---
        if (!role) {
            role = await Role.findOne({ 
                where: { user_role: { [Op.like]: '%INCHARGE%' } },
                include: [{ model: Scope }]
            });
        }

        if (!role) {
            await t.rollback();
            return res.status(404).json({ message: `Role '${role_name}' and generic 'INCHARGE' role not found` });
        }

        // --- NEW: Sync RoleUser Profile ---
        // Dashboards rely on RoleUser. If user is Faculty/Staff but doesn't have RoleUser, create it.
        if (!user.RoleUser) {
            const profile = user.Faculty || user.Staff;
            await RoleUser.create({
                user_id: user.user_id,
                name: profile ? profile.name : "Incharge User",
                email: profile ? profile.email : `user_${user.user_id}@taskapp.com`,
                created_at: new Date(),
                updated_at: new Date()
            }, { transaction: t });
        }

        // 1. Remove any existing assignments for this venue
        await RoleAssignment.destroy({ where: { venue_id: id }, transaction: t });

        // 2. Create new assignment
        await RoleAssignment.create({
            user_id,
            role_id: role.role_id,
            venue_id: id,
            department_id: department_id || null,
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({
            message: 'Venue incharge assigned successfully',
            assigned_user: user.user_id,
            role: role_name,
            scope: role.Scope?.scope || 'Infrastructure'
        });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.getDepartmentAnalytics = async (req, res) => {
    try {
        const { id } = req.params; // Department ID

        const department = await Department.findByPk(id);
        if (!department) return res.status(404).json({ message: 'Department not found' });

        // 1. Total Counts
        const studentCount = await Student.count({ where: { department_id: id } });
        const facultyCount = await Faculty.count({ where: { department_id: id } });

        // 2. HOD Details
        const hodAssignment = await RoleAssignment.findOne({
            where: { department_id: id, '$Role.user_role$': 'HOD' },
            include: [
                { model: Role, attributes: ['user_role'] },
                {
                    model: User,
                    include: [{ model: RoleUser, attributes: ['name', 'email'] }]
                }
            ]
        });

        // 3. Average Scores
        const studentAvg = await Student.findOne({
            where: { department_id: id },
            attributes: [[sequelize.fn('AVG', sequelize.col('score')), 'avgScore']],
            raw: true
        });

        const facultyAvg = await Faculty.findOne({
            where: { department_id: id },
            attributes: [[sequelize.fn('AVG', sequelize.col('score')), 'avgScore']],
            raw: true
        });

        // 4. Top 3 Scorers (Students)
        const topStudents = await Student.findAll({
            where: { department_id: id },
            order: [['score', 'DESC']],
            limit: 3,
            attributes: ['user_id', 'name', 'email', 'score', 'reg_no']
        });

        // 5. Top 3 Scorers (Faculty)
        const topFaculty = await Faculty.findAll({
            where: { department_id: id },
            order: [['score', 'DESC']],
            limit: 3,
            attributes: ['user_id', 'name', 'email', 'score', 'reg_no']
        });

        res.json({
            department_name: department.name,
            total_students: studentCount,
            total_faculty: facultyCount,
            hod: hodAssignment && hodAssignment.User && hodAssignment.User.RoleUser ? {
                user_id: hodAssignment.user_id,
                name: hodAssignment.User.RoleUser.name,
                email: hodAssignment.User.RoleUser.email
            } : null,
            averages: {
                student_avg_score: parseFloat(studentAvg?.avgScore || 0).toFixed(2),
                faculty_avg_score: parseFloat(facultyAvg?.avgScore || 0).toFixed(2)
            },
            top_performers: {
                students: topStudents,
                faculty: topFaculty
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// --- Venue Usage Analytics ---
exports.getVenueUsageReport = async (req, res) => {
    try {
        const { id } = req.params; // Venue ID
        const venue = await Venue.findByPk(id, {
            include: [
                { model: Resource },
                {
                    model: Task,
                    limit: 10,
                    order: [['created_at', 'DESC']],
                    include: [{ model: TaskType }]
                }
            ]
        });

        if (!venue) return res.status(404).json({ message: 'Venue not found' });

        res.json({
            venue_name: venue.name,
            location: venue.location,
            total_resources: venue.Resources ? venue.Resources.length : 0,
            resources: venue.Resources || [],
            recent_tasks: venue.Tasks ? venue.Tasks.map(t => ({
                task_id: t.task_id,
                title: t.title,
                category: t.category,
                time: t.TaskTypes?.[0] || null
            })) : []
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- Unified Manage Resource (Incharge/Admin) ---
exports.manageResource = async (req, res) => {
    const t = await Resource.sequelize.transaction();
    try {
        const { venue_id, name, new_total_quantity, faulty_report } = req.body;
        // faulty_report: { quantity, status, reason }

        if (!venue_id || !name) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'venue_id and name are required' });
        }

        // 1. Get all records for this resource in this venue
        const resources = await Resource.findAll({
            where: { venue_id, name },
            transaction: t
        });

        let availableResource = resources.find(r => r.status === 'available');
        
        // Ensure available resource exists
        if (!availableResource) {
            availableResource = await Resource.create({
                venue_id,
                name,
                quantity: 0,
                status: 'available'
            }, { transaction: t });
            resources.push(availableResource);
        }

        const currentTotal = resources.reduce((sum, r) => sum + (r.quantity || 0), 0);

        // 2. Adjust Total Quantity first if provided
        if (new_total_quantity !== undefined) {
            const diff = new_total_quantity - currentTotal;
            const newAvailableQty = availableResource.quantity + diff;
            
            if (newAvailableQty < 0) {
                await t.rollback();
                return res.status(400).json({ 
                    success: false, 
                    message: `Total quantity cannot be reduced below current faulty/in-use items (${currentTotal - availableResource.quantity})` 
                });
            }
            await availableResource.update({ quantity: newAvailableQty }, { transaction: t });
        }

        // 3. Handle Faulty Report if provided
        if (faulty_report && faulty_report.quantity !== undefined && faulty_report.quantity >= 0) {
            const { quantity, status, reason } = faulty_report;
            
            if (!['damaged', 'broken', 'under maintenance'].includes(status)) {
                await t.rollback();
                return res.status(400).json({ success: false, message: 'Invalid faulty status' });
            }

            let targetResource = resources.find(r => r.status === status);
            const currentFaultyQty = targetResource ? (targetResource.quantity || 0) : 0;
            const diffFaulty = quantity - currentFaultyQty;

            if (diffFaulty !== 0) {
                // Fresh check of available quantity after potential adjustment
                if (diffFaulty > 0 && availableResource.quantity < diffFaulty) {
                    await t.rollback();
                    return res.status(400).json({ success: false, message: 'Not enough available quantity to report faulty items' });
                }

                // Move from/to available
                await availableResource.update({ quantity: availableResource.quantity - diffFaulty }, { transaction: t });

                // Create/Update/Delete faulty entry
                if (targetResource) {
                    if (quantity === 0) {
                        await targetResource.destroy({ transaction: t });
                        targetResource = null;
                    } else {
                        await targetResource.update({ quantity }, { transaction: t });
                    }
                } else if (quantity > 0) {
                    targetResource = await Resource.create({
                        venue_id,
                        name,
                        description: availableResource.description,
                        quantity,
                        status
                    }, { transaction: t });
                }

                // Create Maintenance Log ONLY if items became faulty
                if (diffFaulty > 0 && targetResource) {
                    const { MaintenanceLog } = require('../models');
                    await MaintenanceLog.create({
                        venue_id,
                        resource_id: targetResource.resource_id,
                        category: 'Fault Reporting',
                        issue_title: `${name} reported as ${status.toUpperCase()}`,
                        description: reason || `Reported ${diffFaulty} new items as ${status}`,
                        status: 'pending',
                        start_time: new Date()
                    }, { transaction: t });
                }
            }
        }

        await t.commit();
        res.json({ success: true, message: 'Resource managed successfully' });

    } catch (error) {
        await t.rollback();
        console.error('Error in manageResource:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- Update Resource Quantity (Incharge/Admin) ---
exports.updateResourceQuantity = async (req, res) => {
    try {
        const { id } = req.params; // resource_id
        const { quantity } = req.body;

        const resource = await Resource.findByPk(id);
        if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

        await resource.update({ quantity });

        res.json({ success: true, message: 'Quantity updated successfully', resource });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- Report Faulty Resource (Incharge) ---
exports.reportFaultyResource = async (req, res) => {
    const t = await Resource.sequelize.transaction();
    try {
        const { id } = req.params; // resource_id
        const { quantity, status, reason } = req.body; // status: 'damaged', 'broken', 'under maintenance'

        if (!['damaged', 'broken', 'under maintenance'].includes(status)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const resource = await Resource.findByPk(id, { transaction: t });
        if (!resource) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Resource not found' });
        }

        if (resource.quantity < quantity) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Not enough available quantity' });
        }

        // 1. Subtract from current resource
        await resource.update({ quantity: resource.quantity - quantity }, { transaction: t });

        // 2. Create/Update a resource entry for the faulty status
        let faultyResource = await Resource.findOne({
            where: {
                venue_id: resource.venue_id,
                name: resource.name,
                status: status
            },
            transaction: t
        });

        if (faultyResource) {
            await faultyResource.update({ quantity: faultyResource.quantity + quantity }, { transaction: t });
        } else {
            faultyResource = await Resource.create({
                venue_id: resource.venue_id,
                name: resource.name,
                description: resource.description,
                quantity: quantity,
                status: status
            }, { transaction: t });
        }

        // 3. Create Maintenance Log
        const { MaintenanceLog } = require('../models');
        await MaintenanceLog.create({
            venue_id: resource.venue_id,
            resource_id: faultyResource.resource_id,
            category: 'Fault Reporting',
            issue_title: `${resource.name} reported as ${status.toUpperCase()}`,
            description: reason || `Reported ${quantity} items as ${status}`,
            status: 'pending',
            start_time: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ success: true, message: 'Resource reported successfully', faultyResource });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ success: false, message: error.message });
    }
};
// Bulk Create Resources from Excel
exports.bulkCreateResources = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const t = await Venue.sequelize.transaction({
        isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED
    });

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (!rows.length) {
            await t.rollback();
            return res.status(400).json({ message: 'Empty sheet' });
        }

        const results = [];
        for (const row of rows) {
            const { name, quantity, status, description, venue_name, venue_id } = row;

            try {
                let vId = venue_id || null;
                if (!vId && venue_name) {
                    const venue = await Venue.findOne({ where: { name: venue_name }, transaction: t });
                    if (venue) vId = venue.venue_id;
                }

                const resource = await Resource.create({
                    name,
                    quantity: quantity || 1,
                    status: status || 'available',
                    description: description || '',
                    venue_id: vId,
                    created_at: new Date(),
                    updated_at: new Date()
                }, { transaction: t });

                results.push({ name: name, status: 'created', id: resource.id });
            } catch (err) {
                results.push({ name: name, status: 'failed', reason: err.message });
            }
        }

        await t.commit();
        res.json({ message: 'Resource bulk upload complete', results });
    } catch (error) {
        if (t && !t.finished) await t.rollback();
        res.status(500).json({ message: 'Bulk upload failed', error: error.message });
    }
};

// Bulk Create Venues from Excel
exports.bulkCreateVenues = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const t = await Venue.sequelize.transaction({
        isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED
    });

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (!rows.length) {
            await t.rollback();
            return res.status(400).json({ message: 'Empty sheet' });
        }

        const results = [];
        for (const row of rows) {
            const { name, venue_type, location, status, description, image_url } = row;

            if (!name) {
                results.push({ name: '(blank)', status: 'skipped', reason: 'Name is required' });
                continue;
            }

            try {
                // Check if venue already exists
                const existing = await Venue.findOne({ where: { name: name.trim() }, transaction: t });

                if (existing) {
                    results.push({ name, status: 'skipped', reason: 'Venue already exists' });
                    continue;
                }

                const venue = await Venue.create({
                    name: name.trim(),
                    venue_type: venue_type || 'others',
                    location: location || null,
                    status: status || 'open',
                    description: description || null,
                    image_url: image_url || null,
                    created_at: new Date(),
                    updated_at: new Date()
                }, { transaction: t });

                results.push({ name, status: 'created', id: venue.venue_id });
            } catch (err) {
                results.push({ name, status: 'failed', reason: err.message });
            }
        }

        await t.commit();
        res.json({ message: 'Venue bulk upload complete', results });
    } catch (error) {
        if (t && !t.finished) await t.rollback();
        res.status(500).json({ message: 'Bulk upload failed', error: error.message });

    }
};

// ==========================================
// Role & Scope Management APIs (Admin Only)
// ==========================================

// Get all scopes
exports.getAllScopes = async (req, res) => {
    try {
        const scopes = await Scope.findAll({ order: [['scope', 'ASC']] });
        res.json(scopes);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Create a new scope
exports.createScope = async (req, res) => {
    try {
        const { scope } = req.body;
        if (!scope) return res.status(400).json({ message: 'scope name is required' });

        const existing = await Scope.findOne({ where: { scope } });
        if (existing) return res.status(400).json({ message: 'Scope already exists' });

        const newScope = await Scope.create({ scope });
        res.status(201).json(newScope);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get all roles (with scope details)
exports.getAllRoles = async (req, res) => {
    try {
        const roles = await Role.findAll({
            include: [{ model: Scope, attributes: ['scope_id', 'scope'] }],
            order: [['user_role', 'ASC']]
        });
        res.json(roles);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Create a new role and assign to a scope
exports.createRole = async (req, res) => {
    try {
        const { role_name, scope_id, scope_name } = req.body;
        if (!role_name) return res.status(400).json({ message: 'role_name is required' });

        // Resolve scope
        let resolvedScopeId = scope_id;
        if (!resolvedScopeId && scope_name) {
            const scope = await Scope.findOne({ where: { scope: scope_name } });
            if (!scope) return res.status(404).json({ message: `Scope '${scope_name}' not found` });
            resolvedScopeId = scope.scope_id;
        }
        if (!resolvedScopeId) return res.status(400).json({ message: 'scope_id or scope_name is required' });

        const existing = await Role.findOne({ where: { user_role: role_name } });
        if (existing) return res.status(400).json({ message: `Role '${role_name}' already exists` });

        const role = await Role.create({
            user_role: role_name,
            scope_id: resolvedScopeId
        });

        const full = await Role.findByPk(role.role_id, {
            include: [{ model: Scope, attributes: ['scope'] }]
        });

        res.status(201).json({ message: `Role '${role_name}' created successfully`, role: full });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update a role's scope
exports.updateRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role_name, scope_id, scope_name } = req.body;

        const role = await Role.findByPk(id);
        if (!role) return res.status(404).json({ message: 'Role not found' });

        let resolvedScopeId = scope_id;
        if (!resolvedScopeId && scope_name) {
            const scope = await Scope.findOne({ where: { scope: scope_name } });
            if (!scope) return res.status(404).json({ message: `Scope '${scope_name}' not found` });
            resolvedScopeId = scope.scope_id;
        }

        await role.update({
            user_role: role_name || role.user_role,
            scope_id: resolvedScopeId || role.scope_id
        });

        res.json({ message: 'Role updated successfully', role });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete a role
exports.deleteRole = async (req, res) => {
    const t = await Role.sequelize.transaction();
    try {
        const { id } = req.params;
        const role = await Role.findByPk(id);
        if (!role) {
            await t.rollback();
            return res.status(404).json({ message: 'Role not found' });
        }

        // 1. Manually nullify references
        await RoleAssignment.update({ role_id: null }, { where: { role_id: id }, transaction: t });

        // 2. Soft delete the role
        await role.destroy({ transaction: t });
        
        await t.commit();
        res.json({ message: 'Role deleted successfully' });
    } catch (error) {
        if (t) await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/resources/export
// Exports resource inventory and usage metrics to Excel
// ─────────────────────────────────────────────────────────────────────────────
exports.exportResourceUtilisation = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole?.toLowerCase();

        const { ResourceUsageLog } = require('../models');

        // 1. Identify relevant resources
        let where = { deleted_at: null };
        if (userRole !== 'admin') {
            const assignments = await RoleAssignment.findAll({
                where: { user_id: userId, venue_id: { [Op.ne]: null } },
                attributes: ['venue_id']
            });
            const managedVenueIds = assignments.map(a => a.venue_id);
            where.venue_id = { [Op.in]: managedVenueIds };
        }

        const resources = await Resource.findAll({
            where,
            include: [{ model: Venue, attributes: ['name'] }]
        });

        const reportData = [];

        for (const resource of resources) {
            // Count total usage occurrences and duration
            const usageLogs = await ResourceUsageLog.findAll({
                where: { resource_id: resource.resource_id }
            });

            let totalMinutes = 0;
            usageLogs.forEach(log => {
                if (log.start_time && log.end_time) {
                    const duration = (new Date(log.end_time) - new Date(log.start_time)) / (1000 * 60);
                    if (duration > 0) totalMinutes += duration;
                }
            });

            reportData.push({
                "Resource ID": resource.resource_id,
                "Resource Name": resource.name,
                "Venue": resource.Venue ? resource.Venue.name : "Master Inventory",
                "Quantity": resource.quantity,
                "Status": resource.status,
                "Total Usage (Times)": usageLogs.length,
                "Total Usage (Minutes)": totalMinutes.toFixed(2),
                "Category": resource.description || "N/A"
            });
        }

        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(reportData);
        xlsx.utils.book_append_sheet(wb, ws, "Resource Utilisation");

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=resource_utilisation_report.xlsx');
        res.send(buffer);

    } catch (error) {
        console.error('RESOURCE EXPORT ERROR:', error);
        res.status(500).json({ message: error.message });
    }
};
