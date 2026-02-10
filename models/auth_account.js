'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AuthAccount extends Model {
    static associate(models) {
      AuthAccount.belongsTo(models.User, {
        foreignKey: 'user_id'
      });
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
    }
  }, {
    sequelize,
    modelName: 'AuthAccount',
    tableName: 'auth_accounts',
    timestamps: false,   // 🔥 VERY IMPORTANT
    underscored: true
  });

  return AuthAccount;
};
