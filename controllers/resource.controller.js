const { Department, Venue, RoleAssignment, User, RoleUser, Role, Resource } = require('../models');
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
    try {
        const { id } = req.params;
        const dept = await Department.findByPk(id);
        if (!dept) return res.status(404).json({ message: 'Department not found' });

        await dept.destroy();
        res.json({ message: 'Department deleted successfully' });
    } catch (error) {
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
        const venues = await Venue.findAll({
            include: [
                {
                    model: RoleAssignment,
                    required: false, // LEFT JOIN - allows venues without incharge
                    include: [
                        {
                            model: User,
                            attributes: ['user_id', 'role', 'status'],
                            include: [
                                {
                                    model: RoleUser,
                                    attributes: ['name', 'email', 'score', 'penalty']
                                }
                            ]
                        },
                        {
                            model: Role,
                            attributes: ['user_role']
                        }
                    ]
                }
            ],
            order: [['venue_id', 'ASC']]
        });

        // Format response to include incharge details
        const formattedVenues = venues.map(venue => {
            const venueData = {
                venue_id: venue.venue_id,
                name: venue.name,
                venue_type: venue.venue_type,
                location: venue.location,
                description: venue.description,
                image_url: venue.image_url,
                created_at: venue.created_at,
                incharge: null
            };

            // Check if there's an assigned incharge
            if (venue.RoleAssignments && venue.RoleAssignments.length > 0) {
                const assignment = venue.RoleAssignments[0]; // Get first assignment
                if (assignment.User && assignment.User.RoleUser) {
                    venueData.incharge = {
                        user_id: assignment.User.user_id,
                        name: assignment.User.RoleUser.name,
                        email: assignment.User.RoleUser.email,
                        role: assignment.Role?.user_role || 'Unknown',
                        score: assignment.User.RoleUser.score,
                        penalty: assignment.User.RoleUser.penalty
                    };
                }
            }

            return venueData;
        });

        res.json(formattedVenues);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Fetch incharge (Role User) for a specific venue
exports.getVenueIncharge = async (req, res) => {
    try {
        const { venueId } = req.params;

        // Find role assignment for this venue
        // Assuming role for incharge is something specific or we just fetch who is assigned
        // The user said: "if like incharge this venue, based on venue id it should fetch the role assigned user"

        const assignment = await RoleAssignment.findOne({
            where: { venue_id: venueId },
            include: [
                {
                    model: User,
                    attributes: ['user_id', 'role', 'status'],
                    include: [
                        {
                            model: RoleUser, // If the user is a 'role-user' type
                            attributes: ['name', 'email']
                        },
                        // Also could be Faculty or Staff, need to handle that if generic
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

        // Flatten response slightly for easier consumption
        let userDetails = null;
        if (assignment.User) {
            // Check RoleUser first as likely target
            if (assignment.User.RoleUser) {
                userDetails = assignment.User.RoleUser;
            } else {
                // Try fetching manually if not eager loaded or different type
            }
        }

        res.json({
            role: assignment.Role ? assignment.Role.user_role : 'Unknown',
            user: userDetails || assignment.User
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

            const role = await Role.findOne({ where: { user_role: role_name } });
            if (!role) {
                await t.rollback();
                return res.status(404).json({ message: `Role '${role_name}' not found` });
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

            const role = await Role.findOne({ where: { user_role: role_name } });
            if (!role) {
                await t.rollback();
                return res.status(404).json({ message: `Role '${role_name}' not found` });
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
    try {
        const { id } = req.params;
        const venue = await Venue.findByPk(id);
        if (!venue) {
            return res.status(404).json({ message: 'Venue not found' });
        }

        // Delete image file
        if (venue.image_url) {
            const imagePath = path.join(__dirname, '..', venue.image_url);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        await venue.destroy();
        res.json({ message: 'Venue deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- Resource CRUD ---

// Get all resources
exports.getAllResources = async (req, res) => {
    try {
        const resources = await Resource.findAll({
            where: { deleted_at: null }
        });
        res.json(resources);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Add Resource
exports.addResource = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Resource name is required' });
        }

        const resource = await Resource.create({ name });
        res.status(201).json({ message: 'Resource created successfully', resource });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update Resource
exports.updateResource = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        const resource = await Resource.findByPk(id);
        if (!resource) {
            return res.status(404).json({ message: 'Resource not found' });
        }

        await resource.update({ name });
        res.json({ message: 'Resource updated successfully', resource });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Delete Resource
exports.deleteResource = async (req, res) => {
    try {
        const { id } = req.params;
        const resource = await Resource.findByPk(id);
        if (!resource) {
            return res.status(404).json({ message: 'Resource not found' });
        }

        await resource.destroy(); // Paranoid delete
        res.json({ message: 'Resource deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Assign or Update Venue Incharge
exports.assignVenueIncharge = async (req, res) => {
    const t = await RoleAssignment.sequelize.transaction();
    try {
        const { id } = req.params; // Venue ID
        const { user_id, role_name, department_id } = req.body;

        if (!user_id || !role_name) {
            return res.status(400).json({ message: 'User ID and Role Name are required' });
        }

        const venue = await Venue.findByPk(id);
        if (!venue) return res.status(404).json({ message: 'Venue not found' });

        const user = await User.findByPk(user_id);
        if (!user) return res.status(404).json({ message: 'User found' });

        const role = await Role.findOne({ where: { user_role: role_name } });
        if (!role) return res.status(404).json({ message: `Role '${role_name}' not found` });

        // 1. Remove any existing assignments for this venue
        await RoleAssignment.destroy({ where: { venue_id: id }, transaction: t });

        // 2. Create new assignment
        await RoleAssignment.create({
            user_id,
            role_id: role.role_id,
            venue_id: user_id && role_name ? id : null, // Ensure ID is used correctly
            department_id: department_id || null, // Default to null for incharges
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Venue incharge assigned successfully' });

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

// Resource CRUD
exports.getAllResources = async (req, res) => {
    try {
        const resources = await Resource.findAll({
            order: [['resource_id', 'ASC']]
        });
        res.json(resources);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.addResource = async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ message: 'Resource name is required' });

        const resource = await Resource.create({ name, description });
        res.status(201).json({ message: 'Resource created successfully', resource });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateResource = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        const resource = await Resource.findByPk(id);
        if (!resource) return res.status(404).json({ message: 'Resource not found' });

        await resource.update({
            name: name || resource.name,
            description: description !== undefined ? description : resource.description
        });

        res.json({ message: 'Resource updated successfully', resource });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Note: deleteResource is already implemented above, ensuring it handles Resources correctly.
// If not already present or if redundant, this will consolidate it.
// Actually, let's make sure only one deleteResource exists for Resources if possible.
// The existing one was around line 401 or 502 as found earlier.
