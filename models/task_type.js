'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TaskType extends Model {
    static associate(models) {
      TaskType.belongsTo(models.Task, { foreignKey: 'task_id' });
      TaskType.belongsTo(models.Venue, { foreignKey: 'venue_id' });
    }
  }

  TaskType.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    task_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    task_name: {
      type: DataTypes.ENUM(
        'Fixed Time Task',
        'Date-Only / Long Task',
        'Floating Task',
        'Subscription Task',
        'Recurring Task',
        'Bidding / Nomination Task',
        'Meeting',
        'Self Log',
        'Permission Request'
      ),
      allowNull: false
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    start_time: {
      type: DataTypes.TIME,
      allowNull: true
    },
    end_time: {
      type: DataTypes.TIME,
      allowNull: true
    },
    max_duration_hours: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    time_quota_hours: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    venue_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    recurrence: {
      type: DataTypes.ENUM('none', 'daily', 'weekly', 'monthly'),
      defaultValue: 'none'
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
    modelName: 'TaskType',
    tableName: 'task_types',
    timestamps: true,
    underscored: true
  });

  return TaskType;
};
