
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if task_id already exists before adding
    const tableDesc = await queryInterface.describeTable('task_otps');

    if (!tableDesc.task_id) {
      await queryInterface.addColumn('task_otps', 'task_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: {
          model: 'tasks',
          key: 'task_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      });
    }

    // Make assignment_id nullable since we might use task_id instead
    await queryInterface.changeColumn('task_otps', 'assignment_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('task_otps', 'task_id');
    await queryInterface.changeColumn('task_otps', 'assignment_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: false
    });
  }
};
