'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // In MySQL, we need to redefine the ENUM with the new value
        await queryInterface.changeColumn('task_types', 'task_name', {
            type: Sequelize.ENUM(
                'Fixed Time Task',
                'Date-Only / Long Task',
                'Floating Task',
                'Subscription Task',
                'Recurring Task',
                'Bidding / Nomination Task',
                'Meeting',
                'Self Log'
            ),
            allowNull: false
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.changeColumn('task_types', 'task_name', {
            type: Sequelize.ENUM(
                'Fixed Time Task',
                'Date-Only / Long Task',
                'Floating Task',
                'Subscription Task',
                'Recurring Task',
                'Bidding / Nomination Task',
                'Meeting'
            ),
            allowNull: false
        });
    }
};
