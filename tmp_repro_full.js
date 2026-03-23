const { Sequelize, Op } = require('sequelize');
const config = require('./config/config.json').development;
const { Task, TaskType, Venue, TaskPackageClosure, TaskClosure, TaskAssign, User, Student, Faculty, Staff, RoleUser } = require('./models');

const sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    dialect: 'mysql',
    logging: true
});

async function test() {
    try {
        console.log('Running Full getDailyTaskReport Query...');
        const userId = 2; // From user's log
        const tasks = await Task.findAll({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType, required: true },
                { model: Venue, attributes: ['name', 'location'] },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskAssign,
                    required: false,
                    include: [{
                        model: User,
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }]
                }
            ],
            order: [['task_id', 'DESC']],
            limit: 1
        });
        console.log('SUCCESS: Found tasks:', tasks.length);
    } catch (e) {
        console.log('FAILURE:', e.message);
    }
    process.exit(0);
}

test();
