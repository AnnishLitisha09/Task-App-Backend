'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Helper function to check if a foreign key exists
      const hasConstraint = async (tableName, constraintName) => {
        const [results] = await queryInterface.sequelize.query(`
          SELECT CONSTRAINT_NAME 
          FROM information_schema.KEY_COLUMN_USAGE 
          WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = '${tableName}' 
            AND CONSTRAINT_NAME = '${constraintName}';
        `, { transaction });
        return results.length > 0;
      };

      // 1. Add deleted_at columns where missing
      const tablesToUpdate = ['users', 'departments', 'faculties', 'staffs', 'students', 'role_users', 'auth_accounts', 'venues', 'roles'];
      for (const table of tablesToUpdate) {
        const tableInfo = await queryInterface.describeTable(table);
        if (!tableInfo.deleted_at) {
          await queryInterface.addColumn(table, 'deleted_at', {
            type: Sequelize.DATE,
            allowNull: true
          }, { transaction });
        }
      }

      // 2. Fix Department Foreign Keys (SET NULL)
      // Make columns nullable first
      await queryInterface.changeColumn('faculties', 'department_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true
      }, { transaction });
      await queryInterface.changeColumn('students', 'department_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true
      }, { transaction });
      await queryInterface.changeColumn('role_assignments', 'department_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true
      }, { transaction });

      // Faculties - Drop old, Add new
      if (await hasConstraint('faculties', 'faculties_ibfk_20')) {
        await queryInterface.removeConstraint('faculties', 'faculties_ibfk_20', { transaction });
      }
      // Check if our new name already exists from a partial run
      if (!(await hasConstraint('faculties', 'faculties_department_id_fk'))) {
        await queryInterface.addConstraint('faculties', {
          fields: ['department_id'],
          type: 'foreign key',
          name: 'faculties_department_id_fk',
          references: {
            table: 'departments',
            field: 'department_id'
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          transaction
        });
      }

      // Role Assignments
      if (await hasConstraint('role_assignments', 'role_assignments_ibfk_31')) {
        await queryInterface.removeConstraint('role_assignments', 'role_assignments_ibfk_31', { transaction });
      }
      if (!(await hasConstraint('role_assignments', 'role_assignments_department_id_fk'))) {
        await queryInterface.addConstraint('role_assignments', {
          fields: ['department_id'],
          type: 'foreign key',
          name: 'role_assignments_department_id_fk',
          references: {
            table: 'departments',
            field: 'department_id'
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          transaction
        });
      }

      // Students
      if (await hasConstraint('students', 'students_ibfk_16')) {
        await queryInterface.removeConstraint('students', 'students_ibfk_16', { transaction });
      }
      if (!(await hasConstraint('students', 'students_department_id_fk'))) {
        await queryInterface.addConstraint('students', {
          fields: ['department_id'],
          type: 'foreign key',
          name: 'students_department_id_fk',
          references: {
            table: 'departments',
            field: 'department_id'
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          transaction
        });
      }

      // 3. Fix Student -> Faculty relation (SET NULL)
      // Make nullable first
      await queryInterface.changeColumn('students', 'faculty_id', {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true
      }, { transaction });

      if (await hasConstraint('students', 'students_ibfk_17')) {
        await queryInterface.removeConstraint('students', 'students_ibfk_17', { transaction });
      }
      if (!(await hasConstraint('students', 'students_faculty_id_fk'))) {
        await queryInterface.addConstraint('students', {
          fields: ['faculty_id'],
          type: 'foreign key',
          name: 'students_faculty_id_fk',
          references: {
            table: 'faculties',
            field: 'id'
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          transaction
        });
      }

      // 4. Ensure AuthAccount references User
      if (!(await hasConstraint('auth_accounts', 'auth_accounts_user_id_fk'))) {
        await queryInterface.addConstraint('auth_accounts', {
          fields: ['user_id'],
          type: 'foreign key',
          name: 'auth_accounts_user_id_fk',
          references: {
            table: 'users',
            field: 'user_id'
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
          transaction
        });
      }

      await transaction.commit();
    } catch (error) {
      if (transaction) await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    // Reverting is risky due to legacy constraint names.
  }
};
