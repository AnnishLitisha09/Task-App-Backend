'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PackageTask extends Model {
    static associate(models) {
      PackageTask.belongsTo(models.Task, { foreignKey: 'task_id' });
      PackageTask.belongsTo(models.User, { foreignKey: 'assignee_id' });
    }
  }

  PackageTask.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    task_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    step: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    step_title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    assignee_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('inactive','pending','completed'),
      defaultValue: 'inactive'
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
    modelName: 'PackageTask',
    tableName: 'package_tasks',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return PackageTask;
};
