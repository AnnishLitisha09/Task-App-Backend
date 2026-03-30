'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE tasks MODIFY COLUMN status 
      ENUM('Active', 'Inactive', 'Pending Approval', 'PAUSED', 'RESUMED', 'Escalated', 'completed') 
      DEFAULT 'Active';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE tasks MODIFY COLUMN status 
      ENUM('Active', 'Inactive', 'Pending Approval', 'PAUSED', 'RESUMED', 'Escalated') 
      DEFAULT 'Active';
    `);
  }
};
