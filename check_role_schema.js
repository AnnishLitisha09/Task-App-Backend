const { sequelize } = require('./models');
const fs = require('fs');

async function checkSchema() {
    try {
        const [results] = await sequelize.query('DESCRIBE roles');
        let output = '';
        results.forEach(col => {
            output += `${col.Field}: Nullable=${col.Null}, Type=${col.Type}\n`;
        });
        fs.writeFileSync('role_schema_output.txt', output);
        console.log('Schema written to role_schema_output.txt');
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkSchema();
