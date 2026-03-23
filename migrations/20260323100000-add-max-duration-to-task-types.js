'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('task_types');
    
    if (!tableInfo.max_duration_hours) {
      await queryInterface.addColumn('task_types', 'max_duration_hours', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        after: 'end_time'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('task_types', 'max_duration_hours');
  }
};
