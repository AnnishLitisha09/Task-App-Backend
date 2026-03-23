'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('resources', 'quantity', {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: 1
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('resources', 'quantity');
    }
};
