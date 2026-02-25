const db = require('./models');
const fs = require('fs');

async function check() {
    const result = {
        user: await db.User.findByPk(14),
        profiles: {}
    };

    const profiles = ['Student', 'Faculty', 'Staff', 'RoleUser'];
    for (const p of profiles) {
        const found = await db[p].findOne({ where: { user_id: 14 } });
        if (found) result.profiles[p] = found;
    }

    fs.writeFileSync('user_14_data.json', JSON.stringify(result, null, 2));
    process.exit();
}
check();
