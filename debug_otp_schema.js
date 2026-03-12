const { sequelize } = require('./models');

async function debug() {
  try {
    const [columns] = await sequelize.query('SHOW COLUMNS FROM task_otps');
    console.log('--- task_otps Schema ---');
    columns.forEach(col => {
      console.log(`${col.Field}: ${col.Type}`);
    });
  } catch (err) {
    console.error('DEBUG ERROR:', err);
  } finally {
    process.exit();
  }
}

debug();
