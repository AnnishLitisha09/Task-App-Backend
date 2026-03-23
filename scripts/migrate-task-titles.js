const { sequelize } = require('../models');

async function migrate() {
    try {
        const queryInterface = sequelize.getQueryInterface();

        console.log('--- Dropping foreign key and task_titles table ---');

        // 1. Remove FK from tasks (handling possible existing constraint)
        try {
            await queryInterface.removeColumn('tasks', 'task_title_id');
        } catch (e) {
            console.log('Column task_title_id might not exist or constraint already removed.');
        }

        // 2. Drop table
        await queryInterface.dropTable('task_titles', { cascade: true });

        // 3. Recreate table
        console.log('--- Recreating simplified task_titles table ---');
        await queryInterface.createTable('task_titles', {
            id: { type: require('sequelize').DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
            task_title: { type: require('sequelize').DataTypes.STRING(255), allowNull: false, unique: true },
            target_role: { type: require('sequelize').DataTypes.ENUM('student', 'faculty', 'staff', 'admin', 'all'), defaultValue: 'all' },
            created_at: { type: require('sequelize').DataTypes.DATE, defaultValue: require('sequelize').DataTypes.NOW },
            updated_at: { type: require('sequelize').DataTypes.DATE, defaultValue: require('sequelize').DataTypes.NOW },
            deleted_at: { type: require('sequelize').DataTypes.DATE, allowNull: true }
        });

        // 4. Add column back to tasks
        console.log('--- Adding task_title_id back to tasks table ---');
        await queryInterface.addColumn('tasks', 'task_title_id', {
            type: require('sequelize').DataTypes.BIGINT.UNSIGNED,
            allowNull: true,
            references: {
                model: 'task_titles',
                key: 'id'
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
