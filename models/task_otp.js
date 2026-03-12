'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class TaskOTP extends Model {
        static associate(models) {
            TaskOTP.belongsTo(models.TaskAssign, { foreignKey: 'assignment_id' });
            TaskOTP.belongsTo(models.Task, { foreignKey: 'task_id' });
        }
    }

    TaskOTP.init({
        otp_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        assignment_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },
        task_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },
        otp_code: {
            type: DataTypes.STRING(6),
            allowNull: false
        },
        otp_type: {
            type: DataTypes.ENUM('START', 'END'),
            allowNull: false
        },
        expires_at: {
            type: DataTypes.DATE,
            allowNull: false
        },
        is_used: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        sequelize,
        modelName: 'TaskOTP',
        tableName: 'task_otps',
        timestamps: false,
        underscored: true
    });

    return TaskOTP;
};
