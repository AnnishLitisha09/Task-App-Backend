'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AuthAccount extends Model {
    static associate(models) {
      AuthAccount.belongsTo(models.User, { foreignKey: 'user_id' });
      AuthAccount.hasOne(models.Student, { foreignKey: 'user_id', sourceKey: 'user_id' });
      AuthAccount.hasOne(models.Faculty, { foreignKey: 'user_id', sourceKey: 'user_id' });
      AuthAccount.hasOne(models.Staff, { foreignKey: 'user_id', sourceKey: 'user_id' });
      AuthAccount.hasOne(models.RoleUser, { foreignKey: 'user_id', sourceKey: 'user_id' });
    }
  }

  AuthAccount.init({
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: false,
      unique: true
    },
    hashed_password: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    is_logged_in: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    fcm_token: {
      type: DataTypes.STRING(255),
      allowNull: true
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
    modelName: 'AuthAccount',
    tableName: 'auth_accounts',
    timestamps: true,
    paranoid: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  });

  return AuthAccount;
};
