'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Task extends Model {
    static associate(models) {
      Task.belongsTo(models.Venue, { foreignKey: 'venue_id' });
      Task.belongsTo(models.User, { foreignKey: 'approver_id', as: 'Approver' });
      Task.belongsTo(models.User, { foreignKey: 'creator_id', as: 'Creator' });
      Task.belongsTo(models.Faculty, { foreignKey: 'faculty_id' });
      Task.belongsTo(models.Resource, { foreignKey: 'resource_id' });
      Task.hasMany(models.TaskType, { foreignKey: 'task_id' }); // One task → many task types
      Task.hasMany(models.TaskPackageClosure, { foreignKey: 'task_id' });
      Task.hasMany(models.TaskAssign, { foreignKey: 'task_id' }); // One task → many assignments
      Task.hasMany(models.TaskEscalation, { foreignKey: 'task_id' }); // One task → many escalations
    }
  }

  Task.init({
    task_id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT },
    category: { type: DataTypes.ENUM('Academic', 'Admin', 'Compliance', 'Others'), allowNull: false },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false },
    is_package: { type: DataTypes.BOOLEAN, defaultValue: false },
    venue_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    is_pause_allowed: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_approved: { type: DataTypes.BOOLEAN, defaultValue: false },
    approver_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    score: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    penalty_per_hour: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    package_completion: { type: DataTypes.JSON },
    is_escalate: { type: DataTypes.BOOLEAN, defaultValue: false },
    is_document: { type: DataTypes.BOOLEAN, defaultValue: false },
    creator_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('Active', 'Inactive'), defaultValue: 'Active' },
    is_mandatory: { type: DataTypes.BOOLEAN, defaultValue: false },
    resource_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    is_faculty: { type: DataTypes.BOOLEAN, defaultValue: false },
    faculty_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    sequelize,
    modelName: 'Task',
    tableName: 'tasks',
    timestamps: false,
    underscored: true
  });

  return Task;
};
