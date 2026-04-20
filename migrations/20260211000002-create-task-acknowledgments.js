'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('task_acknowledgments', {
            acknowledgment_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                autoIncrement: true,
                primaryKey: true,
                allowNull: false
            },
            task_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: {
                    model: 'tasks',
                    key: 'task_id'
                },
                onDelete: 'CASCADE'
            },
            user_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'user_id'
                },
                onDelete: 'CASCADE'
            },
            acknowledge_date: {
                type: Sequelize.DATEONLY,
                allowNull: false
            },
            acknowledged_at: {
                type: Sequelize.DATE,
                allowNull: true
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });

        // Add index for faster queries
        await queryInterface.addIndex('task_acknowledgments', ['task_id', 'user_id', 'acknowledge_date']);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('task_acknowledgments');
    }
};
