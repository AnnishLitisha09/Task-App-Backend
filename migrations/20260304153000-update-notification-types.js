'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('notifications', 'type', {
            type: Sequelize.ENUM('task_created', 'task_rejected', 'task_escalation', 'task_transfer', 'task_approval_request', 'task_approved', 'general'),
            defaultValue: 'general',
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.changeColumn('notifications', 'type', {
            type: Sequelize.ENUM('task_created', 'task_rejected', 'task_escalation', 'task_transfer', 'general'),
            defaultValue: 'general',
            allowNull: true
        });
    }
};
