'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Leave extends Model {
    static associate(models) {
      Leave.belongsTo(models.User, {
        foreignKey: 'user_id'
      });
    }
  }

  Leave.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true
    },

    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },

    leave_type: {
      type: DataTypes.ENUM(
        'sick_leave',
        'gp',
        'sp',
        'onduty',
        'emergency_leave'
      ),
      allowNull: false
    },

    from_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },

    to_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },

    reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    status: {
      type: DataTypes.STRING(30),
      defaultValue: 'pending'
    }

  }, {
    sequelize,
    modelName: 'Leave',
    tableName: 'leaves',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return Leave;
};
