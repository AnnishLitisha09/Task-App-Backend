const { RoleAssignment, User, Role } = require('./models');

async function debugRoleAssignments() {
    try {
        const assignments = await RoleAssignment.findAll({
            // include: [{ model: User, attributes: ['id', 'user_id'] }, { model: Role, attributes: ['user_role'] }]
        });
        console.log("Total Assignments:", assignments.length);
        assignments.forEach(a => {
            console.log(`User: ${a.user_id}, Role: ${a.role_id}, Dept: ${a.department_id}, Venue: ${a.venue_id}`);
        });
    } catch (error) {
        console.error("Error:", error);
    }
}

debugRoleAssignments();
