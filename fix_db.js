const { Sequelize } = require('sequelize');
const config = require('./config/config.json'); // Adjust path if needed

// Initialize Sequelize
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

async function fixDatabase() {
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        // 1. Add columns to staffs table
        console.log('Adding columns to staffs table...');
        try {
            await sequelize.query("ALTER TABLE staffs ADD COLUMN score DECIMAL(10, 2) DEFAULT 0;");
            await sequelize.query("ALTER TABLE staffs ADD COLUMN total_score DECIMAL(10, 2) DEFAULT 0;");
            await sequelize.query("ALTER TABLE staffs ADD COLUMN penalty DECIMAL(10, 2) DEFAULT 0;");
            console.log('Columns added to staffs table.');
        } catch (error) {
            console.log('Error adding to staffs (might already exist):', error.message);
        }

        // 2. Add total_score to role_users table
        console.log('Adding total_score to role_users table...');
        try {
            await sequelize.query("ALTER TABLE role_users ADD COLUMN total_score DECIMAL(10, 2) DEFAULT 0;");
            console.log('total_score added to role_users table.');
        } catch (error) {
            console.log('Error adding to role_users (might already exist):', error.message);
        }

        // 3. Add score and penalty to role_users if missing (just in case)
        try {
            await sequelize.query("ALTER TABLE role_users ADD COLUMN score DECIMAL(10, 2) DEFAULT 0;");
            await sequelize.query("ALTER TABLE role_users ADD COLUMN penalty DECIMAL(10, 2) DEFAULT 0;");
        } catch (error) {
            // Ignore if exists
        }

        console.log('Database fix completed.');

    } catch (error) {
        console.error('Unable to connect to the database:', error);
    } finally {
        await sequelize.close();
    }
}

fixDatabase();
