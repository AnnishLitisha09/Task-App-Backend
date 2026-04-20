'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('auth_accounts');

        if (!tableDefinition.fcm_token) {
            await queryInterface.addColumn('auth_accounts', 'fcm_token', {
                type: Sequelize.STRING(255),
                allowNull: true
            });
        }
    },

    down: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('auth_accounts');
        if (tableDefinition.fcm_token) {
            await queryInterface.removeColumn('auth_accounts', 'fcm_token');
        }
    }
};
