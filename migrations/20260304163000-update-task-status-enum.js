'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('tasks', 'status', {
            type: Sequelize.ENUM('Active', 'Inactive', 'Pending Approval'),
            defaultValue: 'Active',
            allowNull: false
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.changeColumn('tasks', 'status', {
            type: Sequelize.ENUM('Active', 'Inactive'),
            defaultValue: 'Active',
            allowNull: false
        });
    }
};
