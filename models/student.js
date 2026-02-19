'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Student extends Model {
    static associate(models) {
      Student.belongsTo(models.User, { foreignKey: 'user_id' });
      Student.belongsTo(models.Department, { foreignKey: 'department_id' });
      Student.belongsTo(models.Faculty, { foreignKey: 'faculty_id' });
      Student.belongsTo(models.AuthAccount, { foreignKey: 'user_id' });
      // Student can have many task assignments
      Student.hasMany(models.TaskAssign, { foreignKey: 'user_id' });
    }
  }

  Student.init({
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true
    },
    reg_no: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    department_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    score: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    total_score: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    penalty: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    c_gpa: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true
    },
    faculty_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
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
    modelName: 'Student',
    tableName: 'students',
    timestamps: true,
    paranoid: true, // soft delete
    underscored: true
  });

  return Student;
};
