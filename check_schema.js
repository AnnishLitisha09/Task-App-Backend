const { sequelize } = require('./models');

async function check() {
    try {
        const [results] = await sequelize.query('SHOW CREATE TABLE task_assign');
        console.log(results[0]['Create Table']);
    } catch (e) {
        console.error(e);
    }
}

check();
