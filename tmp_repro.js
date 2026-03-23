const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config/config.json').development;

const sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    dialect: 'mysql',
    logging: true
});

const Task = require('./models/task')(sequelize, DataTypes);
const TaskType = require('./models/task_type')(sequelize, DataTypes);
const TaskAssign = require('./models/task_assign')(sequelize, DataTypes);
const Venue = require('./models/venue')(sequelize, DataTypes);

Task.hasMany(TaskType, { foreignKey: 'task_id' });
Task.hasMany(TaskAssign, { foreignKey: 'task_id' });
Task.belongsTo(Venue, { foreignKey: 'venue_id' });

async function test() {
    try {
        console.log('Attempting Task.findAll with task_title_id...');
        const tasks = await Task.findAll({
            attributes: ['task_id', 'task_title_id', 'title'],
            limit: 1
        });
        console.log('SUCCESS: Found tasks:', tasks.length);
    } catch (e) {
        console.log('FAILURE:', e.message);
        if (e.original) {
            console.log('Original Error SQL:', e.original.sql);
        }
    }
    process.exit(0);
}

test();
