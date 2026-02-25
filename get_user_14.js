const { User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role } = require('./models');

async function getUserDetails(userId) {
    try {
        const user = await User.findByPk(userId, {
            include: [
                { model: Student },
                { model: Faculty },
                { model: Staff },
                { model: RoleUser },
                {
                    model: RoleAssignment,
                    include: [{ model: Role }]
                }
            ]
        });

        if (!user) {
            console.log(`User ${userId} not found.`);
            return;
        }

        const profile = user.Student || user.Faculty || user.Staff || user.RoleUser;
        const assignments = user.RoleAssignments || [];

        console.log('--- User Details ---');
        console.log(`User ID: ${user.user_id}`);
        console.log(`Base Role: ${user.role}`);
        console.log(`Email: ${user.email}`);

        if (profile) {
            console.log(`Name: ${profile.name}`);
            console.log(`Profile Type: ${profile.constructor.name}`);
        } else {
            console.log('Profile: No linked profile details found.');
        }

        if (assignments.length > 0) {
            console.log('\n--- Special Assignments ---');
            assignments.forEach(ra => {
                console.log(`- Role: ${ra.Role ? ra.Role.user_role : 'N/A'} (ID: ${ra.role_id})`);
                if (ra.venue_id) console.log(`  Venue ID: ${ra.venue_id}`);
                if (ra.department_id) console.log(`  Department ID: ${ra.department_id}`);
            });
        }

    } catch (error) {
        console.error('Error fetching user details:', error);
    } finally {
        process.exit();
    }
}

getUserDetails(14);
