require('dotenv').config();
const { Role, Scope } = require('./models');

async function fixRoles() {
    try {
        const roles = [
            { user_role: 'HOD', scope_id: 3 },
            { user_role: 'DEAN', scope_id: 2 },
            { user_role: 'PRINCIPAL', scope_id: 2 },
            { user_role: 'DIRECTOR', scope_id: 2 },
            { user_role: 'INCHARGE', scope_id: 1 }
        ];

        for (const r of roles) {
            const [role, created] = await Role.findOrCreate({
                where: { user_role: r.user_role },
                defaults: r
            });
            if (created) {
                console.log(`Created role: ${r.user_role}`);
            } else {
                console.log(`Role already exists: ${r.user_role}`);
            }
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

fixRoles();
