'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class ResourceUsageLog extends Model {
        static associate(models) {
            ResourceUsageLog.belongsTo(models.Resource, { foreignKey: 'resource_id' });
            ResourceUsageLog.belongsTo(models.User, { foreignKey: 'user_id' });
            ResourceUsageLog.belongsTo(models.Venue, { foreignKey: 'venue_id' });
        }
    }

    ResourceUsageLog.init({
        usage_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        resource_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        user_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        venue_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        start_time: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        end_time: {
            type: DataTypes.DATE,
            allowNull: true
        },
        start_otp: {
            type: DataTypes.STRING(6),
            allowNull: true
        },
        end_otp: {
            type: DataTypes.STRING(6),
            allowNull: true
        },
        is_verified: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        }
    }, {
        sequelize,
        modelName: 'ResourceUsageLog',
        tableName: 'resource_usage_logs',
        timestamps: true,
        underscored: true
    });

    return ResourceUsageLog;
};
