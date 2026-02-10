'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RoleAssignment extends Model {
    static associate(models) {
      RoleAssignment.belongsTo(models.User, { foreignKey: 'user_id' });
      RoleAssignment.belongsTo(models.Role, { foreignKey: 'role_id' });
      RoleAssignment.belongsTo(models.Department, { foreignKey: 'department_id' });
      RoleAssignment.belongsTo(models.Venue, { foreignKey: 'venue_id' });
    }
  }

  RoleAssignment.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    role_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    department_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    venue_id: {
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
    }
  }, {
    sequelize,
    modelName: 'RoleAssignment',
    tableName: 'role_assignments',
    timestamps: true,
    underscored: true
  });

  return RoleAssignment;
};
