const { sequelize } = require('./models');

async function fix() {
  try {
    console.log('Attempting to make assignment_id nullable in task_otps...');
    await sequelize.query('ALTER TABLE task_otps MODIFY COLUMN assignment_id BIGINT UNSIGNED NULL');
    console.log('✅ Successfully made assignment_id nullable');
  } catch (err) {
    console.error('❌ Error modifying column:', err.message);
  } finally {
    process.exit();
  }
}

fix();
