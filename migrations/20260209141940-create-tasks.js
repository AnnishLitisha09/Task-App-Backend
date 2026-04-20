'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tasks', {
      task_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      title: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT },
      category: { type: Sequelize.ENUM('Academic','Admin','Compliance','Others'), allowNull: false },
      priority: { type: Sequelize.ENUM('low','medium','high'), allowNull: false },
      is_package: { type: Sequelize.BOOLEAN, defaultValue: false },
      venue_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: {
          model: 'venues',
          key: 'venue_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      is_pause_allowed: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_approved: { type: Sequelize.BOOLEAN, defaultValue: false },
      approver_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: {
          model: 'users',
          key: 'user_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      score: { type: Sequelize.DECIMAL(10,2), defaultValue: 0 },
      penalty_per_hour: { type: Sequelize.DECIMAL(10,2), defaultValue: 0 },
      package_completion: { type: Sequelize.JSON, allowNull: true },
      is_escalate: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_document: { type: Sequelize.BOOLEAN, defaultValue: false },
      creator_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: {
          model: 'users',
          key: 'user_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      is_deleted: { type: Sequelize.BOOLEAN, defaultValue: false },
      status: { type: Sequelize.ENUM('Active','Inactive'), defaultValue: 'Active' },
      is_mandatory: { type: Sequelize.BOOLEAN, defaultValue: false },
      resource_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: {
          model: 'resources',
          key: 'resource_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      is_faculty: { type: Sequelize.BOOLEAN, defaultValue: false },
      faculty_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
        references: {
          model: 'faculties',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('tasks');
  }
};
