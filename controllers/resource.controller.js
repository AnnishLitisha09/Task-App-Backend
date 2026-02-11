const { Department, Venue, RoleAssignment, User, RoleUser, Role, Resource } = require('../models');
const fs = require('fs');
const path = require('path');

exports.getAllDepartments = async (req, res) => {
    try {
        const departments = await Department.findAll();
        res.json(departments);
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
    try {
        const { name, venue_type, location, description } = req.body;
        const image_url = req.file ? `/uploads/venues/${req.file.filename}` : null;

        if (!name) {
            return res.status(400).json({ message: 'Venue name is required' });
        }

        const venue = await Venue.create({
            name,
            venue_type: venue_type || 'others',
            location,
            description,
            image_url
        });

        res.status(201).json({ message: 'Venue created successfully', venue });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update Venue
exports.updateVenue = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, venue_type, location, description } = req.body;

        const venue = await Venue.findByPk(id);
        if (!venue) {
            return res.status(404).json({ message: 'Venue not found' });
        }

        const updateData = { name, venue_type, location, description };

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

        await venue.update(updateData);
        res.json({ message: 'Venue updated successfully', venue });
    } catch (error) {
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
