'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Add status to venues
        await queryInterface.addColumn('venues', 'status', {
            type: Sequelize.ENUM('open', 'under maintenance', 'temporarily closed', 'renovation', 'full day booked'),
            allowNull: true,
            defaultValue: 'open'
        });

        // Add status to resources
        await queryInterface.addColumn('resources', 'status', {
            type: Sequelize.ENUM('available', 'under maintenance', 'damaged', 'broken'),
            allowNull: true,
            defaultValue: 'available'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('venues', 'status');
        await queryInterface.removeColumn('resources', 'status');
        // Note: To truly undo ENUM columns in MySQL/PostgreSQL, you might need to drop the type, 
        // but for simple cases, removeColumn is sufficient for the table structure.
    }
};
