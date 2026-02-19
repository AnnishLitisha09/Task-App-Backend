const { sequelize } = require('./models');

async function fixSchema() {
    try {
        console.log('Attempting to make task_id nullable in task_acknowledgments...');

        // 1. Identify foreign key name (this might vary, so we'll try to drop it if we can find it, 
        // but often changeColumn handles it if it's NOT NULL. MySQL sometimes requires raw SQL)

        // Let's try raw SQL to bypass any Sequelize abstractions that might be failing
        await sequelize.query('ALTER TABLE task_acknowledgments MODIFY COLUMN task_id BIGINT UNSIGNED NULL');

        console.log('✅ Successfully Altred table.');

        // Verify
        const [results] = await sequelize.query('DESCRIBE task_acknowledgments');
        console.log('Current schema for task_id:');
        const taskIdCol = results.find(r => r.Field === 'task_id');
        console.log(JSON.stringify(taskIdCol, null, 2));

    } catch (error) {
        console.error('❌ Error fixing schema:', error.message);
    } finally {
        process.exit();
    }
}

fixSchema();
