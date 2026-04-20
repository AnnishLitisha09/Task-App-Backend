'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        try {
            await queryInterface.addColumn('role_users', 'total_score', {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0,
                allowNull: true
            });
        } catch (error) {
            console.log('Column total_score might already exist in role_users table.');
        }
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('role_users', 'total_score');
    }
};
