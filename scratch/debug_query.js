require('dotenv').config();
const { Department, Faculty, sequelize } = require('../models');

async function test() {
    try {
        const results = await Department.findAll({
            attributes: {
                include: [
                    [
                        sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM faculties AS f
                            WHERE f.department_id = departments.department_id
                        )`),
                        'count_test'
                    ]
                ]
            },
            limit: 1,
            logging: console.log
        });
        console.log('Results:', JSON.stringify(results, null, 2));
    } catch (err) {
        console.error('ERROR:', err.message);
    }
    process.exit();
}

test();
