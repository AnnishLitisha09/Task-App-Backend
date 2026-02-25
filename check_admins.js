const db = require('./models');
const fs = require('fs');

async function getAllAdmins() {
    const admins = await db.User.findAll({
        where: { role: 'admin' },
        include: [
            { model: db.AuthAccount, attributes: ['email'] },
            { model: db.Faculty, attributes: ['name'] },
            { model: db.Staff, attributes: ['name'] },
            { model: db.RoleUser, attributes: ['name'] }
        ]
    });

    const result = admins.map(a => ({
        user_id: a.user_id,
        role: a.role,
        email: a.AuthAccount ? a.AuthAccount.email : 'N/A',
        name: (a.Faculty || a.Staff || a.RoleUser || {}).name || 'N/A',
        profile_type: a.Faculty ? 'Faculty' : a.Staff ? 'Staff' : a.RoleUser ? 'RoleUser' : 'None'
    }));

    fs.writeFileSync('all_admins.json', JSON.stringify(result, null, 2));
    process.exit();
}
getAllAdmins();
