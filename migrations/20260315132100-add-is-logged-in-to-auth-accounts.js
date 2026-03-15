'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('auth_accounts');

        if (!tableDefinition.is_logged_in) {
            await queryInterface.addColumn('auth_accounts', 'is_logged_in', {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
                allowNull: false
            });
        }
    },

    down: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('auth_accounts');
        if (tableDefinition.is_logged_in) {
            await queryInterface.removeColumn('auth_accounts', 'is_logged_in');
        }
    }
};
