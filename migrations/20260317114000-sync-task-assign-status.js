'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE task_assign MODIFY COLUMN status 
      ENUM('pending', 'accepted', 'in_progress', 'paused', 'completed', 'rejected', 'frozen', 'escalated', 'not_completed', 'queued') 
      DEFAULT 'pending';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE task_assign MODIFY COLUMN status 
      ENUM('pending', 'accepted', 'in_progress', 'completed', 'rejected', 'frozen', 'escalated', 'paused') 
      DEFAULT 'pending';
    `);
  }
};
