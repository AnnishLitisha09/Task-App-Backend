'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('leaves', {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },

      user_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false
      },

      leave_type: {
        type: Sequelize.ENUM(
          'sick_leave',
          'gp',
          'sp',
          'onduty',
          'emergency_leave'
        ),
        allowNull: false
      },

      from_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },

      to_date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },

      reason: {
        type: Sequelize.TEXT,
        allowNull: true
      },

      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'pending'
      },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },

      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
        )
      },

      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('leaves');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_leaves_leave_type";'
    );
  }
};
