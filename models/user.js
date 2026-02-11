'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      // Define associations here if needed
      User.hasOne(models.Student, { foreignKey: 'user_id' });
      User.hasOne(models.Faculty, { foreignKey: 'user_id' });
      User.hasOne(models.Staff, { foreignKey: 'user_id' });
      User.hasOne(models.RoleUser, { foreignKey: 'user_id' });
      User.hasMany(models.RoleAssignment, { foreignKey: 'user_id' });
    }
  }

  User.init({
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    role: {
      type: DataTypes.ENUM('student', 'staff', 'faculty', 'admin', 'role-user'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    timestamps: false,
    paranoid: true, // Optional: enables soft delete using deleted_at
    underscored: true
  });

  return User;
};
