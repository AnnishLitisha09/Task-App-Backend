'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('faculties', 'type', {
            type: Sequelize.STRING(50),
            allowNull: true,
            defaultValue: 'Regular' // Default value if needed, or null
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('faculties', 'type');
    }
};
