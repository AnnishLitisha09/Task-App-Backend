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
        title: { type: DataTypes.STRING(255), allowNull: false, unique: true }
    }, {
        sequelize,
        modelName: 'TaskTitle',
        tableName: 'task_titles',
        timestamps: false,
        underscored: true
    });

    return TaskTitle;
};
