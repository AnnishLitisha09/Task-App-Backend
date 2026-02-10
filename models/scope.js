'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Scope extends Model {
    static associate(models) {
      // Scope has many roles
      Scope.hasMany(models.Role, { foreignKey: 'scope_id' });
    }
  }

  Scope.init({
    scope_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    scope: {
      type: DataTypes.STRING(50),
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
    modelName: 'Scope',
    tableName: 'scopes',
    timestamps: true,
    underscored: true
  });

  return Scope;
};
