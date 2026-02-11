'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('task_types', 'start_time', {
      type: Sequelize.TIME,
      allowNull: true
    });
    await queryInterface.addColumn('task_types', 'end_time', {
      type: Sequelize.TIME,
      allowNull: true
    });
    await queryInterface.addColumn('task_types', 'time_quota_hours', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true
    });
    await queryInterface.addColumn('task_types', 'venue_id', {
      type: Sequelize.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: 'venues',
        key: 'venue_id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('task_types', 'start_time');
    await queryInterface.removeColumn('task_types', 'end_time');
    await queryInterface.removeColumn('task_types', 'time_quota_hours');
    await queryInterface.removeColumn('task_types', 'venue_id');
  }
};
