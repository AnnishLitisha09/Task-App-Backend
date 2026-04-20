'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const tablesToUpdate = [
        'role_assignments',
        'leaves',
        'package_tasks',
        'resources',
        'task_types',
        'task_titles',
        'task_closure',
        'task_assign'
      ];

      for (const table of tablesToUpdate) {
        const tableInfo = await queryInterface.describeTable(table);
        if (!tableInfo.deleted_at) {
          await queryInterface.addColumn(table, 'deleted_at', {
            type: Sequelize.DATE,
            allowNull: true
          }, { transaction });
        }
      }

      await transaction.commit();
    } catch (error) {
      if (transaction) await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      const tablesToUpdate = [
        'role_assignments',
        'leaves',
        'package_tasks',
        'resources',
        'task_types',
        'task_titles',
        'task_closure',
        'task_assign'
      ];

      for (const table of tablesToUpdate) {
        const tableInfo = await queryInterface.describeTable(table);
        if (tableInfo.deleted_at) {
          await queryInterface.removeColumn(table, 'deleted_at', { transaction });
        }
      }

      await transaction.commit();
    } catch (error) {
      if (transaction) await transaction.rollback();
      throw error;
    }
  }
};
