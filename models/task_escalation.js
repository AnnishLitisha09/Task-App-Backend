'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class TaskEscalation extends Model {
        static associate(models) {
            TaskEscalation.belongsTo(models.Task, { foreignKey: 'task_id' });
            TaskEscalation.belongsTo(models.User, { foreignKey: 'creator_id', as: 'Creator' }); // The "To" user
            TaskEscalation.belongsTo(models.User, { foreignKey: 'rejected_user_id', as: 'RejectedUser' }); // The "From" user
        }
    }

    TaskEscalation.init({
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        task_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        reason: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        creator_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        rejected_user_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('pending', 'reviewed', 'resolved'),
            defaultValue: 'pending'
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
        modelName: 'TaskEscalation',
        tableName: 'task_escalations',
        timestamps: true,
        underscored: true
    });

    return TaskEscalation;
};
