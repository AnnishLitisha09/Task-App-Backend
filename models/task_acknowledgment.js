'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class TaskAcknowledgment extends Model {
        static associate(models) {
            TaskAcknowledgment.belongsTo(models.Task, { foreignKey: 'task_id' });
            TaskAcknowledgment.belongsTo(models.User, { foreignKey: 'user_id' });
        }
    }

    TaskAcknowledgment.init({
        acknowledgment_id: {
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
        acknowledge_date: {
            type: DataTypes.DATEONLY,
            allowNull: false
        },
        acknowledged_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        sequelize,
        modelName: 'TaskAcknowledgment',
        tableName: 'task_acknowledgments',
        timestamps: false,
        underscored: true
    });

    return TaskAcknowledgment;
};
