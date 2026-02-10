'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add 'description' column
    await queryInterface.addColumn('venues', 'description', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: 'Optional description of the venue'
    });

    // Add 'image_url' column
    await queryInterface.addColumn('venues', 'image_url', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Optional image URL of the venue'
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove columns if rolling back
    await queryInterface.removeColumn('venues', 'description');
    await queryInterface.removeColumn('venues', 'image_url');
  }
};
