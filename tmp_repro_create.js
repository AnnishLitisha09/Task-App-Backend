const { Sequelize, DataTypes } = require('sequelize');
const config = require('./config/config.json').development;
const { Task, TaskType, TaskAssign, TaskTitle, Faculty, User, Student, RoleUser, Staff, TaskLog, Venue, TaskPackageClosure, TaskClosure } = require('./models');

const sequelize = new Sequelize(config.database, config.username, config.password, {
    host: config.host,
    dialect: 'mysql',
    logging: true
});

async function test() {
    const t = await sequelize.transaction();
    try {
        const userId = 2;
        const task_title_id = 18;
        const faculty_id = 6;
        const category = 'Admin';
        const priority = 'medium';
        const score = 140;
        const penalty_per_hour = 0;
        const is_document = true;
        const is_mandatory = false;
        const origin_type = 'directive';

        // Partial normalization logic from controller
        let finalTitle = 'Academic Review Meeting';
        let resolvedFacultyId = 2; // confirmed earlier

        console.log('Attempting Task.create in transaction...');
        const parentTask = await Task.create({
            title: finalTitle,
            description: '',
            category,
            priority,
            task_title_id: task_title_id || null,
            is_package: false,
            venue_id: null,
            is_pause_allowed: false,
            score: score || 0,
            penalty_per_hour: penalty_per_hour || 0,
            is_document: is_document || false,
            is_mandatory: is_mandatory || false,
            is_approved: true,
            approver_id: null,
            resource_id: null,
            is_faculty: true,
            faculty_id: resolvedFacultyId,
            creator_id: userId,
            origin_type: origin_type || 'directive',
            status: 'Active'
        }, { transaction: t });

        console.log('Task.create SUCCESS. ID:', parentTask.task_id);
        await t.commit();
    } catch (e) {
        console.log('FAILURE:', e.message);
        if (e.original) console.log('SQL:', e.original.sql);
        if (e.errors) console.log('Validation Errors:', e.errors.map(ve => ve.message));
        await t.rollback();
    }
    process.exit(0);
}

test();
