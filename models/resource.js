'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Resource extends Model {
    static associate(models) {
      Resource.hasMany(models.Task, { foreignKey: 'resource_id' });
      Resource.belongsTo(models.Venue, { foreignKey: 'venue_id' });
    }
  }

  Resource.init({
    resource_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    venue_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: 'venues',
        key: 'venue_id'
      }
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1
    },
    description: {
      type: DataTypes.TEXT,
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
    modelName: 'Resource',
    tableName: 'resources',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return Resource;
};
