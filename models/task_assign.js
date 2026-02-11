'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TaskAssign extends Model {
    static associate(models) {
      TaskAssign.belongsTo(models.Task, { foreignKey: 'task_id' });
      TaskAssign.belongsTo(models.User, { foreignKey: 'user_id' });
    }
  }

  TaskAssign.init({
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    task_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'completed', 'rejected'), defaultValue: 'pending' },
    reason: { type: DataTypes.TEXT, allowNull: true },
    proof: { type: DataTypes.STRING(255), allowNull: true },
    submitted_time: { type: DataTypes.DATE, allowNull: true },
    accepted_at: { type: DataTypes.DATE, allowNull: true },
    rejected_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    deleted_at: { type: DataTypes.DATE, allowNull: true }
  }, {
    sequelize,
    modelName: 'TaskAssign',
    tableName: 'task_assign',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return TaskAssign;
};
