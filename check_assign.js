const { sequelize } = require('./models');

async function checkTaskAssign() {
    try {
        const [results] = await sequelize.query("DESCRIBE task_assign");
        console.log(JSON.stringify(results.map(r => r.Field), null, 2));
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
}

checkTaskAssign();
