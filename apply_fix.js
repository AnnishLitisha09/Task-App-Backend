const { sequelize } = require('./models');

async function fixSchema() {
    try {
        console.log("Applying database fixes...");

        // 1. Add is_paused to tasks
        try {
            await sequelize.query("ALTER TABLE tasks ADD COLUMN is_paused TINYINT(1) NULL DEFAULT 0");
            console.log("Added 'is_paused' column to 'tasks' table.");
        } catch (err) {
            if (err.message.includes("Duplicate column name")) {
                console.log("'is_paused' column already exists in 'tasks' table.");
            } else {
                throw err;
            }
        }

        // 2. Add rejected_at to task_assign if missing (check report)
        // Actually, report didn't mention it. Let's trust the error.

        console.log("Database fixes applied successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Error applying fixes:", error);
        process.exit(1);
    }
}

fixSchema();
