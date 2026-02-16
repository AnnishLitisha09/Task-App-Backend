'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('role_users', 'total_score', {
            type: Sequelize.DECIMAL(10, 2),
            defaultValue: 0,
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('role_users', 'total_score');
    }
};
