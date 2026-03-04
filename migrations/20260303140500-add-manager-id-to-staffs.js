'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('staffs', 'manager_id', {
            type: Sequelize.BIGINT.UNSIGNED,
            allowNull: true,
            after: 'user_id',
            references: {
                model: 'users',
                key: 'user_id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn('staffs', 'manager_id');
    }
};
