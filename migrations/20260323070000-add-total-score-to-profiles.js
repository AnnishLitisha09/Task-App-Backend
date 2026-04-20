'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 1. Add total_score to faculties
      const facTable = await queryInterface.describeTable('faculties');
      if (!facTable.total_score) {
        await queryInterface.addColumn('faculties', 'total_score', {
          type: Sequelize.DECIMAL(10, 2),
          defaultValue: 0
        }, { transaction });
      }

      // 2. Add total_score to students
      const studTable = await queryInterface.describeTable('students');
      if (!studTable.total_score) {
        await queryInterface.addColumn('students', 'total_score', {
          type: Sequelize.DECIMAL(10, 2),
          defaultValue: 0
        }, { transaction });
      }

      // 3. Ensure score and penalty have defaults of 0 for all three tables
      const tables = ['faculties', 'students', 'staffs'];
      for (const table of tables) {
        await queryInterface.changeColumn(table, 'score', {
          type: Sequelize.DECIMAL(10, 2),
          defaultValue: 0
        }, { transaction });
        await queryInterface.changeColumn(table, 'penalty', {
          type: Sequelize.DECIMAL(10, 2),
          defaultValue: 0
        }, { transaction });
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
      await queryInterface.removeColumn('faculties', 'total_score', { transaction });
      await queryInterface.removeColumn('students', 'total_score', { transaction });
      await transaction.commit();
    } catch (error) {
      if (transaction) await transaction.rollback();
      throw error;
    }
  }
};
