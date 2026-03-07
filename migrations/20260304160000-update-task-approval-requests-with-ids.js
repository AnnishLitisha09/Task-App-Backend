'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('task_approval_requests', 'task_id', {
            type: Sequelize.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: 'tasks',
                key: 'task_id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });

        await queryInterface.addColumn('task_approval_requests', 'task_ids', {
            type: Sequelize.JSON,
            allowNull: true,
            comment: 'Stores IDs of all created tasks for recurring/package tasks'
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('task_approval_requests', 'task_id');
        await queryInterface.removeColumn('task_approval_requests', 'task_ids');
    }
};
