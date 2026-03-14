'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class MaintenanceLog extends Model {
        static associate(models) {
            MaintenanceLog.belongsTo(models.Venue, { foreignKey: 'venue_id' });
            MaintenanceLog.belongsTo(models.Resource, { foreignKey: 'resource_id' });
        }
    }

    MaintenanceLog.init({
        log_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        venue_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },
        resource_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },
        category: {
            type: DataTypes.STRING(100), // Changed from ENUM to STRING for flexibility
            allowNull: false
        },
        cost: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        location: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        issue_title: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'cancelled'),
            defaultValue: 'pending'
        },
        start_time: {
            type: DataTypes.DATE,
            allowNull: true
        },
        end_time: {
            type: DataTypes.DATE,
            allowNull: true
        }
    }, {
        sequelize,
        modelName: 'MaintenanceLog',
        tableName: 'maintenance_logs',
        timestamps: true,
        underscored: true
    });

    return MaintenanceLog;
};
