'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Coupon extends Model {
    static associate(models) {
      Coupon.hasMany(models.Redeem, {
        foreignKey: 'coupon_id'
      });
    }
  }

  Coupon.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true
    },

    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },

    validity: {
      type: DataTypes.DATE,
      allowNull: false
    },

    status: {
      type: DataTypes.STRING(30),
      defaultValue: 'active'
    },

    total_count: {
      type: DataTypes.INTEGER,
      allowNull: false
    },

    remaining_count: {
      type: DataTypes.INTEGER,
      allowNull: false
    }

  }, {
    sequelize,
    modelName: 'Coupon',
    tableName: 'coupons',
    timestamps: true,
    underscored: true
  });

  return Coupon;
};
