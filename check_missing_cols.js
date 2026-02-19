const { sequelize, Task, TaskAssign, TaskEscalation, TaskLog, TaskType } = require('./models');
const fs = require('fs');

async function syncSchema() {
    let report = "SCHEMA MISSING COLUMNS REPORT\n============================\n\n";
    try {
        const checkTable = async (model, tableName) => {
            try {
                const [results] = await sequelize.query(`DESCRIBE ${tableName}`);
                const dbColumns = results.map(r => r.Field);
                const modelColumns = Object.keys(model.rawAttributes);

                const missing = modelColumns.filter(c => !dbColumns.includes(c));
                if (missing.length > 0) {
                    report += `Table '${tableName}' is missing columns: ${missing.join(', ')}\n`;
                    for (const col of missing) {
                        const attr = model.rawAttributes[col];
                        let type = attr.type.toString();

                        if (type.includes('BOOLEAN')) type = 'TINYINT(1)';
                        else if (type.includes('ENUM')) {
                            if (attr.type.values) {
                                const values = attr.type.values.map(v => `'${v}'`).join(',');
                                type = `ENUM(${values})`;
                            } else {
                                type = 'STRING';
                            }
                        }
                        else if (type.includes('DECIMAL')) type = 'DECIMAL(10,2)';
                        else if (type.includes('JSON')) type = 'JSON';
                        else if (type.includes('BIGINT')) type = 'BIGINT UNSIGNED';
                        else if (type.includes('DATE')) type = 'DATETIME';
                        else if (type.includes('STRING')) {
                            const len = attr.type._length || 255;
                            type = `VARCHAR(${len})`;
                        }
                        else if (type.includes('TEXT')) type = 'TEXT';

                        const defaultValue = attr.defaultValue !== undefined ?
                            ` DEFAULT ${typeof attr.defaultValue === 'boolean' ? (attr.defaultValue ? 1 : 0) :
                                (attr.defaultValue === 'NOW' || attr.defaultValue === 'CURRENT_TIMESTAMP' ? 'CURRENT_TIMESTAMP' : `'${attr.defaultValue}'`)}` : '';

                        const allowNull = attr.allowNull === false ? ' NOT NULL' : ' NULL';

                        const sql = `ALTER TABLE ${tableName} ADD COLUMN ${col} ${type}${allowNull}${defaultValue};`;
                        report += `${sql}\n`;
                    }
                    report += "\n";
                } else {
                    report += `Table '${tableName}' is up to date.\n\n`;
                }
            } catch (err) {
                if (err.message.includes("doesn't exist")) {
                    report += `Table '${tableName}' does not exist.\n\n`;
                } else {
                    report += `Error checking table '${tableName}': ${err.message}\n\n`;
                }
            }
        };

        await checkTable(Task, 'tasks');
        await checkTable(TaskAssign, 'task_assign');
        await checkTable(TaskEscalation, 'task_escalations');
        await checkTable(TaskLog, 'task_logs');
        await checkTable(TaskType, 'task_types');

        fs.writeFileSync('missing_cols_report.txt', report);
        console.log("Report saved to missing_cols_report.txt");
        process.exit(0);
    } catch (error) {
        console.error("Error syncing schema:", error);
        process.exit(1);
    }
}

syncSchema();
