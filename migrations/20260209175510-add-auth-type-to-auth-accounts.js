'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('auth_accounts', 'auth_type', {
      type: Sequelize.ENUM('LOCAL', 'GOOGLE'),
      allowNull: false,
      defaultValue: 'LOCAL'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('auth_accounts', 'auth_type');
  }
};
