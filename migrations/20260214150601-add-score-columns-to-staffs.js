'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('staffs', 'score', {
            type: Sequelize.DECIMAL(10, 2),
            defaultValue: 0,
            allowNull: true
        });

        await queryInterface.addColumn('staffs', 'total_score', {
            type: Sequelize.DECIMAL(10, 2),
            defaultValue: 0,
            allowNull: true
        });

        await queryInterface.addColumn('staffs', 'penalty', {
            type: Sequelize.DECIMAL(10, 2),
            defaultValue: 0,
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('staffs', 'penalty');
        await queryInterface.removeColumn('staffs', 'total_score');
        await queryInterface.removeColumn('staffs', 'score');
    }
};
