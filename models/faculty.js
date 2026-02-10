'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Faculty extends Model {
    static associate(models) {
      Faculty.belongsTo(models.User, { foreignKey: 'user_id' });
      Faculty.belongsTo(models.Department, { foreignKey: 'department_id' });
      // Faculty can have many tasks assigned (if needed)
      Faculty.hasMany(models.Task, { foreignKey: 'faculty_id' });
    }
  }

  Faculty.init({
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    reg_no: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    department_id: {
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
      type: DataTypes.DECIMAL(10,2),
      defaultValue: 0
    },
    penalty: {
      type: DataTypes.DECIMAL(10,2),
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
    modelName: 'Faculty',
    tableName: 'faculties',
    timestamps: true,
    paranoid: true, // enables soft delete using deleted_at
    underscored: true
  });

  return Faculty;
};
