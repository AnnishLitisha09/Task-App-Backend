'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Venue extends Model {
    static associate(models) {
      // Venue has many role assignments
      Venue.hasMany(models.RoleAssignment, { foreignKey: 'venue_id' });
      // Venue can have tasks assigned
      Venue.hasMany(models.Task, { foreignKey: 'venue_id' });
      // Venue has many resources
      Venue.hasMany(models.Resource, { foreignKey: 'venue_id' });
    }
  }

  Venue.init({
    venue_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    venue_type: {
      type: DataTypes.ENUM('class', 'auditorium', 'seminar hall', 'conference room', 'others'),
      allowNull: true,
      defaultValue: 'others'
    },
    location: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    description: {                  // <-- new column
      type: DataTypes.TEXT,
      allowNull: true
    },
    image_url: {                     // <-- new column
      type: DataTypes.STRING(255),
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
    modelName: 'Venue',
    tableName: 'venues',
    timestamps: true,
    underscored: true
  });

  return Venue;
};
