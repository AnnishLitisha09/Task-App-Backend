'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('maintenance_logs', {
            log_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                autoIncrement: true,
                primaryKey: true
            },
            venue_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: true,
                references: {
                    model: 'venues',
                    key: 'venue_id'
                },
                onDelete: 'CASCADE'
            },
            resource_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: true,
                references: {
                    model: 'resources',
                    key: 'resource_id'
                },
                onDelete: 'CASCADE'
            },
            category: {
                type: Sequelize.ENUM('electrical', 'technical', 'infrastructure', 'maintenance'),
                allowNull: false
            },
            cost: {
                type: Sequelize.DECIMAL(10, 2),
                defaultValue: 0
            },
            description: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            location: {
                type: Sequelize.STRING(255),
                allowNull: true
            },
            issue_title: {
                type: Sequelize.STRING(255),
                allowNull: false
            },
            status: {
                type: Sequelize.ENUM('pending', 'in_progress', 'completed', 'cancelled'),
                defaultValue: 'pending'
            },
            start_time: {
                type: Sequelize.DATE,
                allowNull: true
            },
            end_time: {
                type: Sequelize.DATE,
                allowNull: true
            },
            created_at: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.NOW
            },
            updated_at: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.NOW
            }
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('maintenance_logs');
    }
};
