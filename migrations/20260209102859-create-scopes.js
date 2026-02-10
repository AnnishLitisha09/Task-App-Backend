'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('scopes', {
      scope_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      scope: {
        type: Sequelize.STRING(50), // Infrastructure, Institution, Department
        allowNull: false,
        unique: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });

    // Insert default values
    await queryInterface.bulkInsert('scopes', [
      { scope: 'Infrastructure' },
      { scope: 'Institution' },
      { scope: 'Department' }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('scopes');
  }
};
