'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        try {
            await queryInterface.addColumn('staffs', 'score', {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0,
                allowNull: true
            });
        } catch (error) {
            console.log('Column score might already exist in staffs table.');
        }

        try {
            await queryInterface.addColumn('staffs', 'total_score', {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0,
                allowNull: true
            });
        } catch (error) {
            console.log('Column total_score might already exist in staffs table.');
        }

        try {
            await queryInterface.addColumn('staffs', 'penalty', {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0,
                allowNull: true
            });
        } catch (error) {
            console.log('Column penalty might already exist in staffs table.');
        }
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('staffs', 'penalty');
        await queryInterface.removeColumn('staffs', 'total_score');
        await queryInterface.removeColumn('staffs', 'score');
    }
};
