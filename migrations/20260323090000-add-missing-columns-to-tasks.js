'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('tasks');
    
    if (!tableInfo.task_title_id) {
      await queryInterface.addColumn('tasks', 'task_title_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        after: 'task_id'
      });
    }

    if (!tableInfo.is_approved) {
      await queryInterface.addColumn('tasks', 'is_approved', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        after: 'is_pause_allowed'
      });
    }

    if (!tableInfo.approver_id) {
      await queryInterface.addColumn('tasks', 'approver_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        after: 'is_approved'
      });
    }

    if (!tableInfo.score) {
      await queryInterface.addColumn('tasks', 'score', {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        after: 'approver_id'
      });
    }

    if (!tableInfo.penalty_per_hour) {
      await queryInterface.addColumn('tasks', 'penalty_per_hour', {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        after: 'score'
      });
    }

    if (!tableInfo.sequence_order) {
      await queryInterface.addColumn('tasks', 'sequence_order', {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        after: 'faculty_id'
      });
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('tasks', 'task_title_id');
    await queryInterface.removeColumn('tasks', 'is_approved');
    await queryInterface.removeColumn('tasks', 'approver_id');
    await queryInterface.removeColumn('tasks', 'score');
    await queryInterface.removeColumn('tasks', 'penalty_per_hour');
    await queryInterface.removeColumn('tasks', 'sequence_order');
  }
};
