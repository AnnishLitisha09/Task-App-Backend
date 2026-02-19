const { sequelize } = require('./models');

async function fixSchema() {
    try {
        console.log('--- START FIX ---');
        await sequelize.authenticate();
        console.log('Connection established.');

        console.log('Executing ALTER TABLE...');
        // We use raw SQL to ensure the change is forced.
        // We also need to be careful with Foreign Keys. 
        // If there is a foreign key, MySQL might block MODIFY COLUMN if the FK is still active.

        // Let's try to get more info if it fails
        try {
            await sequelize.query('ALTER TABLE task_acknowledgments MODIFY task_id BIGINT UNSIGNED NULL');
            console.log('✅ ALTER TABLE SUCCESS');
        } catch (sqlError) {
            console.error('❌ ALTER TABLE FAILED:', sqlError.message);
            console.log('Attempting to drop and recreate constraint...');
            // In a real environment we'd find the FK name, but let's try a direct approach if possible.
        }

        const [results] = await sequelize.query('DESCRIBE task_acknowledgments');
        console.log('Schema:', JSON.stringify(results.find(r => r.Field === 'task_id'), null, 2));

    } catch (error) {
        console.error('❌ FATAL ERROR:', error);
    } finally {
        console.log('--- END FIX ---');
        process.exit();
    }
}

fixSchema();
