'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class TaskApprovalRequest extends Model {
        static associate(models) {
            TaskApprovalRequest.belongsTo(models.User, { foreignKey: 'approver_id', as: 'Approver' });
            TaskApprovalRequest.belongsTo(models.User, { foreignKey: 'creator_id', as: 'Creator' });
            TaskApprovalRequest.belongsTo(models.Task, { foreignKey: 'task_id', as: 'Task' });
        }
    }

    TaskApprovalRequest.init({
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        approver_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        creator_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
        task_payload: { type: DataTypes.JSON, allowNull: false },
        task_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        task_ids: { type: DataTypes.JSON, allowNull: true },
        status: {
            type: DataTypes.ENUM('pending', 'approved', 'rejected'),
            defaultValue: 'pending',
            allowNull: false
        },
        reason: { type: DataTypes.TEXT, allowNull: true }
    }, {
        sequelize,
        modelName: 'TaskApprovalRequest',
        tableName: 'task_approval_requests',
        timestamps: true,
        underscored: true
    });

    return TaskApprovalRequest;
};
