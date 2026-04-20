'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // In MySQL, we can just alter the column to add the new ENUM value
        await queryInterface.sequelize.query(`
      ALTER TABLE task_types 
      MODIFY COLUMN task_name ENUM(
        'Fixed Time Task',
        'Date-Only / Long Task',
        'Floating Task',
        'Subscription Task',
        'Recurring Task',
        'Bidding / Nomination Task',
        'Meeting',
        'Self Log',
        'Permission Request'
      ) NOT NULL
    `);
    },

    down: async (queryInterface, Sequelize) => {
        // Revert to original ENUM (risky if data has 'Permission Request')
        await queryInterface.sequelize.query(`
      ALTER TABLE task_types 
      MODIFY COLUMN task_name ENUM(
        'Fixed Time Task',
        'Date-Only / Long Task',
        'Floating Task',
        'Subscription Task',
        'Recurring Task',
        'Bidding / Nomination Task',
        'Meeting',
        'Self Log'
      ) NOT NULL
    `);
    }
};
