'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        // PostgreS ENUM modification is tricky. We need to use raw query or alter type.
        // For many DBs, we can just alter the column. 
        // In Postgres, let's use the ALTER TYPE command if it's an ENUM type.

        // First, let's try to add the value to the existing ENUM type
        // We assume the type name is enum_task_assign_status based on Sequelize conventions
        try {
            await queryInterface.sequelize.query("ALTER TYPE \"enum_task_assign_status\" ADD VALUE 'frozen'");
        } catch (error) {
            console.log('ENUM value might already exist or type name is different:', error.message);
            // Fallback: If it fails, it might be because it's not a Postgres ENUM or name is different
        }
    },

    down: async (queryInterface, Sequelize) => {
        // Removing ENUM values is not directly supported in Postgres ALTER TYPE
        // Usually, we just leave it or recreate the type (which is risky if data exists)
        console.log('Rollback of ENUM value "frozen" is not supported.');
    }
};
