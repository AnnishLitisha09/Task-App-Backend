'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // Change category from ENUM to STRING(100)
        await queryInterface.changeColumn('maintenance_logs', 'category', {
            type: Sequelize.STRING(100),
            allowNull: false
        });
    },

    down: async (queryInterface, Sequelize) => {
        // Caution: Changing back to ENUM might fail if there are values not in the ENUM list
        await queryInterface.changeColumn('maintenance_logs', 'category', {
            type: Sequelize.ENUM('electrical', 'technical', 'infrastructure', 'maintenance'),
            allowNull: false
        });
    }
};
