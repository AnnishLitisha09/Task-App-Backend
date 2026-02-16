const { User, Faculty } = require('./models');
const { canAssignTo } = require('./controllers/task.assignment');

async function debug() {
    console.log('--- DEBUG USER 14 ---');
    try {
        const u14 = await User.findByPk(14);
        if (!u14) {
            console.log('User 14 NOT FOUND in DB!');
            return;
        }
        console.log(`User 14 DB Role: '${u14.role}'`);

        // Check Target User 40
        const u40 = await User.findByPk(40);
        console.log(`Target User 40 Role: '${u40 ? u40.role : 'NOT FOUND'}'`);

        if (u40) {
            console.log('Testing canAssignTo(14, 40)...');
            try {
                const result = await canAssignTo(14, 40);
                console.log(`Result: ${result}`);
            } catch (e) {
                console.error('Error in canAssignTo:', e.message);
            }
        }

    } catch (e) {
        console.error(e);
    }
}

debug();
