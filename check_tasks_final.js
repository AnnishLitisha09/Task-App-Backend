const { sequelize } = require('./models');

async function checkTasks() {
    try {
        const [results] = await sequelize.query("DESCRIBE tasks");
        console.log("tasks columns:", JSON.stringify(results.map(r => r.Field), null, 2));
        process.exit(0);
    } catch (error) {
        process.exit(1);
    }
}

checkTasks();
