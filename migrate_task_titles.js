const { sequelize } = require('./models');

async function migrate() {
    try {
        const queryInterface = sequelize.getQueryInterface();

        console.log('--- Dropping foreign key and task_titles table ---');

        // 1. Remove FK from tasks (handling possible existing constraint)
        try {
            // Find constraint name (usually tasks_task_title_id_foreign_idx or similar)
            // But queryInterface.removeColumn often handles it or we can try removing by name if we know it.
            // A safer way is to just drop the column and recreate it if we are reset-ing.
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
            title: { type: require('sequelize').DataTypes.STRING(255), allowNull: false, unique: true }
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
