'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('task_assign', 'accepted_at', {
            type: Sequelize.DATE,
            allowNull: true,
            after: 'submitted_time'
        });

        await queryInterface.addColumn('task_assign', 'rejected_at', {
            type: Sequelize.DATE,
            allowNull: true,
            after: 'accepted_at'
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('task_assign', 'accepted_at');
        await queryInterface.removeColumn('task_assign', 'rejected_at');
    }
};
