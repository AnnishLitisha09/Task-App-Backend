'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        // Since it is an ENUM column in MySQL, we need to redefine it
        await queryInterface.changeColumn('task_assign', 'status', {
            type: Sequelize.ENUM('pending', 'accepted', 'completed', 'rejected'),
            defaultValue: 'pending',
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.changeColumn('task_assign', 'status', {
            type: Sequelize.ENUM('pending', 'completed', 'rejected'),
            defaultValue: 'pending',
            allowNull: true
        });
    }
};
