'use strict';

module.exports = (sequelize, DataTypes) => {
  const TaskPackageClosure = sequelize.define('TaskPackageClosure', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true
    },
    task_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    closure_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    }
  }, {
    tableName: 'task_package_closure',
    timestamps: true,
    underscored: true
  });

  TaskPackageClosure.associate = (models) => {
    TaskPackageClosure.belongsTo(models.Task, {
      foreignKey: 'task_id',
      onDelete: 'CASCADE'
    });

    TaskPackageClosure.belongsTo(models.TaskClosure, {
      foreignKey: 'closure_id',
      onDelete: 'RESTRICT'
    });
  };

  return TaskPackageClosure;
};
