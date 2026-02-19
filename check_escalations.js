const { sequelize } = require('./models');

async function checkEscalations() {
    try {
        const [results] = await sequelize.query("DESCRIBE task_escalations");
        console.log("task_escalations columns:", JSON.stringify(results.map(r => r.Field), null, 2));
        process.exit(0);
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

checkEscalations();
