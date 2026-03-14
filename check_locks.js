const { Sequelize } = require('sequelize');
const config = require('./config/config.json').development;

const sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    dialect: config.dialect,
    logging: false
});

async function diagnose() {
    try {
        console.log('--- Process List ---');
        const [processes] = await sequelize.query('SHOW PROCESSLIST');
        console.table(processes);

        console.log('\n--- InnoDB Status (First 2000 chars) ---');
        const [status] = await sequelize.query('SHOW ENGINE INNODB STATUS');
        console.log(status[0].Status.substring(0, 2000));

        console.log('\n--- Active Locks ---');
        // This might require specific permissions or MySQL 5.7+/8.0
        try {
            const [locks] = await sequelize.query('SELECT * FROM information_schema.innodb_locks');
            console.table(locks);
        } catch (e) {
            console.log('Could not fetch information_schema.innodb_locks (Check permissions or MySQL version)');
        }

        try {
            const [waits] = await sequelize.query('SELECT * FROM information_schema.innodb_lock_waits');
            console.table(waits);
        } catch (e) {
            console.log('Could not fetch information_schema.innodb_lock_waits');
        }

    } catch (error) {
        console.error('Diagnosis failed:', error);
    } finally {
        await sequelize.close();
    }
}

diagnose();
