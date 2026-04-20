'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // 1. Update task_assign status ENUM to include all needed values
      console.log('Ensuring task_assign.status ENUM is complete...');
      await queryInterface.sequelize.query(`
        ALTER TABLE task_assign MODIFY COLUMN status 
        ENUM('pending', 'accepted', 'in_progress', 'completed', 'rejected', 'frozen', 'escalated', 'paused') 
        DEFAULT 'pending';
      `, { transaction });

      // 2. Drop the problematic students FK if it exists
      console.log('Checking for legacy Student FK in task_assign...');
      const [fks] = await queryInterface.sequelize.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'task_assign' 
          AND CONSTRAINT_NAME = 'task_assign_ibfk_16';
      `, { transaction });

      if (fks.length > 0) {
        console.log('Dropping task_assign_ibfk_16...');
        await queryInterface.sequelize.query('ALTER TABLE task_assign DROP FOREIGN KEY task_assign_ibfk_16', { transaction });
      }

      // 3. Ensure assignment_id in task_otps is nullable
      console.log('Ensuring task_otps.assignment_id is nullable...');
      await queryInterface.changeColumn('task_otps', 'assignment_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true
      }, { transaction });

      // 4. Ensure task_id in task_acknowledgments is nullable
      console.log('Ensuring task_acknowledgments.task_id is nullable...');
      await queryInterface.changeColumn('task_acknowledgments', 'task_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true
      }, { transaction });

      await transaction.commit();
      console.log('✅ Schema synchronization migration completed successfully.');
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Schema synchronization migration failed:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Reverting these changes might be complex or unnecessary for a "sync" migration.
    // Usually, we just leave them as-is since they are "fixes".
    console.log('Down migration for schema sync skipped as it is a fix-up migration.');
  }
};
