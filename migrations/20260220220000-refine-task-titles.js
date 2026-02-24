'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        // 1. Rename 'title' to 'task_title'
        await queryInterface.renameColumn('task_titles', 'title', 'task_title');

        // 2. Add 'created_at', 'updated_at', and 'deleted_at'
        await queryInterface.addColumn('task_titles', 'created_at', {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        });
        await queryInterface.addColumn('task_titles', 'updated_at', {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        });
        await queryInterface.addColumn('task_titles', 'deleted_at', {
            type: Sequelize.DATE,
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('task_titles', 'deleted_at');
        await queryInterface.removeColumn('task_titles', 'updated_at');
        await queryInterface.removeColumn('task_titles', 'created_at');
        await queryInterface.renameColumn('task_titles', 'task_title', 'title');
    }
};
