const { Sequelize } = require('sequelize');
const fs = require('fs');
const config = require('./config/config.json').development;

const sequelize = new Sequelize(config.database, config.username, config.password, {
  host: config.host,
  dialect: config.dialect,
  port: config.port,
  logging: false
});

async function diagnose() {
  const diagnosis = {
      tableRows: {},
      indices: {},
      queries: []
  };
  try {
    await sequelize.authenticate();

    const [results] = await sequelize.query("SELECT TABLE_NAME, TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?", {
        replacements: [config.database]
    });
    results.forEach(row => {
        diagnosis.tableRows[row.TABLE_NAME] = row.TABLE_ROWS;
    });

    const tables = ['tasks', 'task_types', 'task_assigns', 'notifications', 'role_assignments', 'users', 'students', 'faculties', 'staffs', 'role_users'];
    for (const table of tables) {
        try {
            const [indices] = await sequelize.query(`SHOW INDEX FROM ${table}`);
            diagnosis.indices[table] = indices.map(idx => ({
                keyName: idx.Key_name,
                columnName: idx.Column_name
            }));
        } catch (e) {
            diagnosis.indices[table] = `Error: ${e.message}`;
        }
    }

    fs.writeFileSync('sys_diagnosis_output.json', JSON.stringify(diagnosis, null, 2));
    console.log('Diagnosis saved to sys_diagnosis_output.json');
  } catch (error) {
    console.error('Diagnostic error:', error);
  } finally {
    await sequelize.close();
  }
}

diagnose();
