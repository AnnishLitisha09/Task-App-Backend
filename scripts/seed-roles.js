'use strict';
const { Role, Scope } = require('./models');

async function seedRoles() {
    try {
        // 1. Get Scopes
        const infraScope = await Scope.findOne({ where: { scope: 'Infrastructure' } });
        const deptScope = await Scope.findOne({ where: { scope: 'Department' } });

        if (!infraScope || !deptScope) {
            console.error('Required scopes (Infrastructure/Department) not found. Please run scope seeds first.');
            process.exit(1);
        }

        const rolesToSeed = [
            { user_role: 'INCHARGE', scope_id: infraScope.scope_id },
            { user_role: 'HOD', scope_id: deptScope.scope_id }
        ];

        for (const r of rolesToSeed) {
            const [role, created] = await Role.findOrCreate({
                where: { user_role: r.user_role },
                defaults: { scope_id: r.scope_id }
            });
            if (created) console.log(`Role '${r.user_role}' created.`);
            else console.log(`Role '${r.user_role}' already exists.`);
        }

        console.log('Roles seeding completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

seedRoles();
