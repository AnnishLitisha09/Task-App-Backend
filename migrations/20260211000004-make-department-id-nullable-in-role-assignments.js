'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.changeColumn('role_assignments', 'department_id', {
            type: Sequelize.BIGINT.UNSIGNED,
            allowNull: true
        });
    },

    async down(queryInterface, Sequelize) {
        // Note: Reverting might fail if there are existing NULLs
        await queryInterface.changeColumn('role_assignments', 'department_id', {
            type: Sequelize.BIGINT.UNSIGNED,
            allowNull: false
        });
    }
};
