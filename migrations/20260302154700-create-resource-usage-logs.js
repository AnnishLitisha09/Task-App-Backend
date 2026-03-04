'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('resource_usage_logs', {
            usage_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                autoIncrement: true,
                primaryKey: true
            },
            resource_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: {
                    model: 'resources',
                    key: 'resource_id'
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
            venue_id: {
                type: Sequelize.BIGINT.UNSIGNED,
                allowNull: false,
                references: {
                    model: 'venues',
                    key: 'venue_id'
                },
                onDelete: 'CASCADE'
            },
            start_time: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.NOW
            },
            end_time: {
                type: Sequelize.DATE,
                allowNull: true
            },
            start_otp: {
                type: Sequelize.STRING(6),
                allowNull: true
            },
            end_otp: {
                type: Sequelize.STRING(6),
                allowNull: true
            },
            is_verified: {
                type: Sequelize.BOOLEAN,
                defaultValue: false
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
        await queryInterface.dropTable('resource_usage_logs');
    }
};
