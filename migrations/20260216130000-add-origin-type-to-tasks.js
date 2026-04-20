'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('tasks', 'origin_type', {
            type: Sequelize.ENUM('directive', 'self-log'),
            allowNull: false,
            defaultValue: 'directive'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('tasks', 'origin_type');
        // Note: Drop the ENUM type as well if your DB requires it (e.g. PostgreSQL)
        // For MySQL, removeColumn is usually sufficient.
    }
};
