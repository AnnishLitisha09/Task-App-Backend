const { sequelize } = require('./models');

async function fixColumn() {
    try {
        console.log('Attempting to alter column maintenance_logs.category...');
        await sequelize.query("ALTER TABLE maintenance_logs MODIFY category VARCHAR(100) NOT NULL;");
        console.log('Success: Column altered to VARCHAR(100)');
        process.exit(0);
    } catch (error) {
        console.error('Failure:', error.message);
        process.exit(1);
    }
}

fixColumn();
