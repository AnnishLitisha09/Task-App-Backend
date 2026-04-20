'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Add max_acceptances to task_types table for Bidding Tasks
        await queryInterface.addColumn('task_types', 'max_acceptances', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: null,
            after: 'recurrence' // Placed after recurrence for better logical grouping
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('task_types', 'max_acceptances');
    }
};
