const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config/config.json');

const sequelize = new Sequelize(
    config.development.database,
    config.development.username,
    config.development.password,
    {
        host: config.development.host,
        dialect: config.development.dialect,
        logging: console.log
    }
);

async function applyUpdates() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database.');

        // 1. Update ENUM for task_assign.status
        console.log('🔄 Updating task_assign status ENUM...');
        try {
            // MySQL specific: modify column to add new enum value
            await sequelize.query("ALTER TABLE task_assign MODIFY COLUMN status ENUM('pending', 'accepted', 'in_progress', 'completed', 'rejected', 'frozen', 'escalated') DEFAULT 'pending';");
            console.log('✅ task_assign status ENUM updated.');
        } catch (error) {
            console.error('❌ Error updating ENUM:', error.message);
        }

        // 2. Create missing tables using models
        console.log('🔄 Syncing missing models...');
        const models = require('./models');

        // We only want to sync specific tables to avoid overwriting data
        await models.TaskAcknowledgment.sync();
        console.log('✅ task_acknowledgments table checked/created.');

        await models.TaskOTP.sync();
        console.log('✅ task_otps table checked/created.');

        await models.TaskEscalation.sync();
        console.log('✅ task_escalations table checked/created.');

        console.log('🚀 All critical schema updates applied successfully.');
    } catch (error) {
        console.error('❌ Schema update failed:', error);
    } finally {
        await sequelize.close();
    }
}

applyUpdates();
