'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('resources', 'description', {
            type: Sequelize.TEXT,
            allowNull: true,
            after: 'name'
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('resources', 'description');
    }
};
