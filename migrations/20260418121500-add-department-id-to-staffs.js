'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('staffs');
        if (!tableDefinition.department_id) {
            await queryInterface.addColumn('staffs', 'department_id', {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: true,
                references: {
                    model: 'departments',
                    key: 'department_id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL'
            });
        }
    },

    down: async (queryInterface, Sequelize) => {
        const tableDefinition = await queryInterface.describeTable('staffs');
        if (tableDefinition.department_id) {
            await queryInterface.removeColumn('staffs', 'department_id');
        }
    }
};
