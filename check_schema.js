const { sequelize } = require('./models');

async function checkSchema() {
    try {
        const [results] = await sequelize.query("DESCRIBE tasks");
        console.log("Tasks Table Schema:");
        console.table(results);

        const [assignResults] = await sequelize.query("DESCRIBE task_assign");
        console.log("\nTask Assign Table Schema:");
        console.table(assignResults);

        process.exit(0);
    } catch (error) {
        console.error("Error checking schema:", error);
        process.exit(1);
    }
}

checkSchema();
