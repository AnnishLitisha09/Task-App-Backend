'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Sync tasks.status ENUM
    await queryInterface.sequelize.query(`
      ALTER TABLE tasks MODIFY COLUMN status 
      ENUM('Active', 'Inactive', 'Pending Approval', 'PAUSED', 'RESUMED', 'Escalated') 
      DEFAULT 'Active';
    `);

    // 2. Sync tasks.priority ENUM
    await queryInterface.sequelize.query(`
      ALTER TABLE tasks MODIFY COLUMN priority 
      ENUM('low', 'medium', 'high', 'critical') 
      NOT NULL;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Reverting to the previous state (assuming previous state from 20260304163000-update-task-status-enum.js)
    await queryInterface.sequelize.query(`
      ALTER TABLE tasks MODIFY COLUMN status 
      ENUM('Active', 'Inactive', 'Pending Approval') 
      DEFAULT 'Active';
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE tasks MODIFY COLUMN priority 
      ENUM('low', 'medium', 'high') 
      NOT NULL;
    `);
  }
};
