'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('task_assign');
    
    if (!tableInfo.earned_score) {
      await queryInterface.addColumn('task_assign', 'earned_score', {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        after: 'rejected_at'
      });
    }
    
    if (!tableInfo.penalty_applied) {
      await queryInterface.addColumn('task_assign', 'penalty_applied', {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        after: 'earned_score'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('task_assign', 'earned_score');
    await queryInterface.removeColumn('task_assign', 'penalty_applied');
  }
};
