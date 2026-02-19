'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('task_escalations', {
            id: {
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
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            reason: {
                type: Sequelize.TEXT,
                allowNull: false
            },
            creator_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'user_id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            rejected_user_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'user_id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            status: {
                type: Sequelize.ENUM('pending', 'reviewed', 'resolved'),
                defaultValue: 'pending'
            },
            is_read: {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
                allowNull: false
            },
            msg: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            created_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            },
            updated_at: {
                allowNull: false,
                type: Sequelize.DATE,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
            }
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('task_escalations');
    }
};
