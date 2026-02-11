const { RoleAssignment, User, Role } = require('./models');

async function testInsert() {
    try {
        // Find a valid user and role to satisfy FKs
        const user = await User.findOne();
        const role = await Role.findOne();

        if (!user || !role) {
            console.log("No user or role found to test with.");
            process.exit(0);
        }

        console.log(`Testing with User ID: ${user.user_id}, Role ID: ${role.role_id}`);

        const ra = await RoleAssignment.create({
            user_id: user.user_id,
            role_id: role.role_id,
            department_id: null, // This is what we want to test
            venue_id: null,
            created_at: new Date(),
            updated_at: new Date()
        });

        console.log("SUCCESS: Record created with NULL department_id");
        console.log(JSON.stringify(ra, null, 2));

        // Cleanup
        await ra.destroy({ force: true });
        console.log("Cleanup: Record deleted.");
        process.exit(0);
    } catch (error) {
        console.error("FAILURE: Error occurred during insertion:");
        console.error(error);
        process.exit(1);
    }
}

testInsert();
