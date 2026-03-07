const { User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role } = require('./models');

async function checkUser17() {
    try {
        const user = await User.findByPk(17, {
            include: [
                { model: Student },
                { model: Faculty },
                { model: Staff },
                { model: RoleUser },
                { model: RoleAssignment, include: [Role] }
            ]
        });

        if (user) {
            console.log('User 17 Details:');
            console.log(JSON.stringify(user, null, 2));
        } else {
            console.log('User 17 not found in the database.');
        }

        // Also check if user 43 exists
        const user43 = await User.findByPk(43, {
            include: [
                { model: Student },
                { model: Faculty },
                { model: Staff },
                { model: RoleUser },
                { model: RoleAssignment, include: [Role] }
            ]
        });

        if (user43) {
            console.log('\nUser 43 Details:');
            console.log(JSON.stringify(user43, null, 2));
        } else {
            console.log('\nUser 43 not found in the database.');
        }

    } catch (error) {
        console.error('Error checking users:', error);
    } finally {
        process.exit();
    }
}

checkUser17();
