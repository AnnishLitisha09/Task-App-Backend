'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class Staff extends Model {
        static associate(models) {
            Staff.belongsTo(models.User, { foreignKey: 'user_id' });
            Staff.belongsTo(models.AuthAccount, { foreignKey: 'user_id' });
            Staff.belongsTo(models.User, { as: 'Manager', foreignKey: 'manager_id' });
            Staff.belongsTo(models.Department, { foreignKey: 'department_id' });
        }
    }

    Staff.init({
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true
        },
        user_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false
        },
        manager_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        department_id: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: true
        },
        email: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true
        },
        designation: {
            type: DataTypes.STRING(100),
            allowNull: true
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
        modelName: 'Staff',
        tableName: 'staffs',
        timestamps: true,
        paranoid: true,
        underscored: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at'
    });

    return Staff;
};
