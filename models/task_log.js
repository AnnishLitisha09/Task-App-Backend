'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class TaskLog extends Model {
        static associate(models) {
            TaskLog.belongsTo(models.Task, { foreignKey: 'task_id' });
            TaskLog.belongsTo(models.User, { foreignKey: 'user_id' });
        }
    }

    TaskLog.init({
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        task_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        user_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        action: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        details: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        sequelize,
        modelName: 'TaskLog',
        tableName: 'task_logs',
        timestamps: true,
        underscored: true
    });

    return TaskLog;
};
