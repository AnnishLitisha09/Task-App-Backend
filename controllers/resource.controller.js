const { Department, Venue, RoleAssignment, User, RoleUser, Role } = require('../models');

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
        const venues = await Venue.findAll();
        res.json(venues);
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
            if (assignment.User.RoleUsers && assignment.User.RoleUsers.length > 0) {
                userDetails = assignment.User.RoleUsers[0]; // hasMany usually returns array
            } else {
                // Try fetching manually if not eager loaded or different type
                // For now, let's assume RoleUser. 
                // If the system allows Faculty to be incharge, we need to check that too.
                // The prompt implies "role assigned user", which usually maps to RoleUser model in this app context.
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
