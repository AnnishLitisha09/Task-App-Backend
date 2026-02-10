'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TaskType extends Model {
    static associate(models) {
      TaskType.belongsTo(models.Task, { foreignKey: 'task_id' });
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
        'Meeting'
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
    recurrence: {
      type: DataTypes.ENUM('none','daily','weekly','monthly'),
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
