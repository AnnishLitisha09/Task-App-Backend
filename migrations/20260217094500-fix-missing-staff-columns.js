'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('staffs');

        if (!tableDefinition.score) {
            await queryInterface.addColumn('staffs', 'score', {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0,
                allowNull: true
            });
        }

        if (!tableDefinition.total_score) {
            await queryInterface.addColumn('staffs', 'total_score', {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0,
                allowNull: true
            });
        }

        if (!tableDefinition.penalty) {
            await queryInterface.addColumn('staffs', 'penalty', {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0,
                allowNull: true
            });
        }
    },

    down: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('staffs');
        if (tableDefinition.penalty) await queryInterface.removeColumn('staffs', 'penalty');
        if (tableDefinition.total_score) await queryInterface.removeColumn('staffs', 'total_score');
        if (tableDefinition.score) await queryInterface.removeColumn('staffs', 'score');
    }
};
