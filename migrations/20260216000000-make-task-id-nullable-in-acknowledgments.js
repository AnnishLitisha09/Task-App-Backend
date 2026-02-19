'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('task_acknowledgments', 'task_id', {
            type: Sequelize.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: 'tasks',
                key: 'task_id'
            },
            onDelete: 'CASCADE'
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.changeColumn('task_acknowledgments', 'task_id', {
            type: Sequelize.BIGINT.UNSIGNED,
            allowNull: false,
            references: {
                model: 'tasks',
                key: 'task_id'
            },
            onDelete: 'CASCADE'
        });
    }
};
