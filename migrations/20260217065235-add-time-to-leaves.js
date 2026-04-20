'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leaves', 'from_time', {
      type: Sequelize.TIME,
      allowNull: true
    });
    await queryInterface.addColumn('leaves', 'to_time', {
      type: Sequelize.TIME,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('leaves', 'from_time');
    await queryInterface.removeColumn('leaves', 'to_time');
  }
};
