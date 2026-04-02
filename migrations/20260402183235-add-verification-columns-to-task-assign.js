'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('task_assign', 'verification_status', {
      type: Sequelize.ENUM('idle', 'pending', 'verified', 'rejected'),
      defaultValue: 'idle',
      allowNull: false
    });
    await queryInterface.addColumn('task_assign', 'proof_rejection_count', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false
    });
    await queryInterface.addColumn('task_assign', 'proof_rejection_reason', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('task_assign', 'resubmission_deadline', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('task_assign', 'resubmission_deadline');
    await queryInterface.removeColumn('task_assign', 'proof_rejection_reason');
    await queryInterface.removeColumn('task_assign', 'proof_rejection_count');
    await queryInterface.removeColumn('task_assign', 'verification_status');
    
    // Removing the ENUM type manually if supported (depending on dialect)
    try {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_task_assign_verification_status;');
    } catch (e) {
      // ignore
    }
  }
};
