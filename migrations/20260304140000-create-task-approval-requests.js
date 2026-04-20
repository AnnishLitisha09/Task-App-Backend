'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('task_approval_requests', {
            id: {
                type: Sequelize.BIGINT.UNSIGNED,
                autoIncrement: true,
                primaryKey: true,
                allowNull: false
            },
            approver_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: { model: 'users', key: 'user_id' },
                onDelete: 'CASCADE'
            },
            creator_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: { model: 'users', key: 'user_id' },
                onDelete: 'CASCADE'
            },
            task_payload: {
                type: Sequelize.JSON,
                allowNull: false,
                comment: 'Full task creation payload to be replayed on approval'
            },
            status: {
                type: Sequelize.ENUM('pending', 'approved', 'rejected'),
                defaultValue: 'pending',
                allowNull: false
            },
            reason: {
                type: Sequelize.TEXT,
                allowNull: true,
                comment: 'Rejection reason'
            },
            created_at: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.NOW,
                allowNull: false
            },
            updated_at: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.NOW,
                allowNull: false
            }
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('task_approval_requests');
    }
};
