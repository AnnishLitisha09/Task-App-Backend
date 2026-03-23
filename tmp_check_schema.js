const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config/config.json').development;

const sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    dialect: 'mysql',
    logging: false
});

async function check() {
    const tables = ['tasks', 'task_assign', 'faculties', 'students', 'staffs', 'role_users', 'task_titles'];
    
    for (const table of tables) {
        try {
            const [results] = await sequelize.query(`DESCRIBE ${table}`);
            const cols = results.map(r => r.Field);
            console.log(`Table: ${table}`);
            console.log(`Columns: ${cols.join(', ')}`);
            console.log('---');
        } catch (e) {
            console.log(`Table: ${table} NOT FOUND OR ERROR: ${e.message}`);
            console.log('---');
        }
    }
    process.exit(0);
}

check();
