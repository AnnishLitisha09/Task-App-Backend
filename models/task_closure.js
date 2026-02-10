'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TaskClosure extends Model {
    static associate(models) {
TaskClosure.hasMany(models.TaskPackageClosure, { foreignKey: 'closure_id' });

    }
  }

  TaskClosure.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(50),   // ✅ NO ENUM
      allowNull: false,
      unique: true                  // otp / document / image should not repeat
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'TaskClosure',
    tableName: 'task_closure',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return TaskClosure;
};
