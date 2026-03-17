'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class RoleUser extends Model {
    static associate(models) {
      RoleUser.belongsTo(models.User, { foreignKey: 'user_id' });
      RoleUser.belongsTo(models.AuthAccount, { foreignKey: 'user_id' });
    }
  }

  RoleUser.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
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
    modelName: 'RoleUser',
    tableName: 'role_users',
    timestamps: true,
    paranoid: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  });

  return RoleUser;
};
