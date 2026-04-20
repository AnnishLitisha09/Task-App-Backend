'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Redeem extends Model {
    static associate(models) {
      Redeem.belongsTo(models.User, {
        foreignKey: 'user_id'
      });

      Redeem.belongsTo(models.Coupon, {
        foreignKey: 'coupon_id'
      });
    }
  }

  Redeem.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    coupon_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    }
  }, {
    sequelize,
    modelName: 'Redeem',
    tableName: 'redeems',
    timestamps: false,
    underscored: true
  });

  return Redeem;
};
