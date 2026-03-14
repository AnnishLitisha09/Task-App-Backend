const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config/config.json').development;

const sequelize = new Sequelize(config.database, config.username, config.password, {
  host: config.host,
  dialect: config.dialect,
  port: config.port,
  logging: console.log
});

async function syncSchema() {
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');

    const queryInterface = sequelize.getQueryInterface();
    const tasksTable = await queryInterface.describeTable('tasks');
    
    if (!tasksTable.sequence_order) {
      console.log('Adding sequence_order to tasks table...');
      await queryInterface.addColumn('tasks', 'sequence_order', {
        type: DataTypes.INTEGER,
        defaultValue: 0
      });
    } else {
      console.log('sequence_order already exists in tasks table.');
    }

    const taskTypesTable = await queryInterface.describeTable('task_types');
    if (!taskTypesTable.max_duration_hours) {
      console.log('Adding max_duration_hours to task_types table...');
      await queryInterface.addColumn('task_types', 'max_duration_hours', {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
      });
    } else {
      console.log('max_duration_hours already exists in task_types table.');
    }

    // Also remove max_duration_minutes if it exists to clean up
    if (taskTypesTable.max_duration_minutes) {
      console.log('Removing max_duration_minutes from task_types table...');
      await queryInterface.removeColumn('task_types', 'max_duration_minutes');
    }

    console.log('Schema sync completed successfully.');
  } catch (error) {
    console.error('Unable to connect to the database or sync schema:', error);
  } finally {
    await sequelize.close();
  }
}

syncSchema();
