'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class TaskTitle extends Model {
        static associate(models) {
            TaskTitle.hasMany(models.Task, { foreignKey: 'task_title_id' });
        }
    }

    TaskTitle.init({
        id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        task_title: { type: DataTypes.STRING(255), allowNull: false, unique: true },
        target_role: {
            type: DataTypes.ENUM('student', 'faculty', 'staff', 'admin', 'all'),
            allowNull: false,
            defaultValue: 'all'
        },
        created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        deleted_at: { type: DataTypes.DATE, allowNull: true }
    }, {
        sequelize,
        modelName: 'TaskTitle',
        tableName: 'task_titles',
        timestamps: true,
        paranoid: true,
        underscored: true
    });

    return TaskTitle;
};
