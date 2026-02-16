const { sequelize } = require('./models');

async function fix() {
    console.log('--- FIXING FK CONSTRAINT ---');
    try {
        await sequelize.query('ALTER TABLE task_assign DROP FOREIGN KEY task_assign_ibfk_16');
        console.log('Dropped FK references students.');

        // Also check if index exists and drop if needed (usually matches constraint name)
        try {
            await sequelize.query('DROP INDEX task_assign_ibfk_16 ON task_assign');
            console.log('Dropped Index task_assign_ibfk_16.');
        } catch (e) {
            console.log('Index drop skipped/failed (might not exist):', e.message);
        }

    } catch (e) {
        console.error('Error dropping FK:', e.message);
    }
}

fix();
