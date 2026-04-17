'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Department extends Model {
    static associate(models) {
      // Department has many Users (students/faculty)
      Department.hasMany(models.Faculty, { foreignKey: 'department_id' });
      Department.hasMany(models.Student, { foreignKey: 'department_id' });
      Department.hasMany(models.Staff, { foreignKey: 'department_id' });
      Department.hasMany(models.RoleAssignment, { foreignKey: 'department_id' });
    }
  }

  Department.init({
    department_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
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
    modelName: 'Department',
    tableName: 'departments',
    timestamps: true,
    paranoid: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  });

  return Department;
};
