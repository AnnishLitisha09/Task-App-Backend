'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('task_titles', 'target_role', {
            type: Sequelize.ENUM('student', 'faculty', 'staff', 'admin', 'all'),
            allowNull: false,
            defaultValue: 'all'
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('task_titles', 'target_role');
    }
};
