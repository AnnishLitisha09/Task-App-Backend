const { Task, TaskType, TaskAssign, User, Student, Faculty, RoleUser, Staff } = require('../models');
const { Op } = require('sequelize');

// PERSONAL CALENDAR: Shows tasks assigned directly to the user
exports.getUserCalendar = async (req, res) => {
    try {
        const userId = req.userId;
        const { date } = req.query; // format 'YYYY-MM-DD'

        let startOfDay, endOfDay;
        if (date) {
            startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
        } else {
            const now = new Date();
            startOfDay = new Date(now.setHours(0, 0, 0, 0));
            endOfDay = new Date(now.setHours(23, 59, 59, 999));
        }

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [
                {
                    model: Task,
                    where: {
                        is_deleted: false,
                        // Exclude venue-specific tasks that are NOT related to faculty duties
                        [Op.not]: [
                            { venue_id: { [Op.ne]: null }, is_faculty: false }
                        ]
                    },
                    include: [
                        {
                            model: TaskType,
                            where: {
                                [Op.or]: [
                                    { start_date: { [Op.between]: [startOfDay, endOfDay] } },
                                    { end_date: { [Op.between]: [startOfDay, endOfDay] } },
                                    {
                                        [Op.and]: [
                                            { start_date: { [Op.lte]: startOfDay } },
                                            { end_date: { [Op.gte]: endOfDay } }
                                        ]
                                    }
                                ]
                            }
                        },
                        {
                            model: Task,
                            as: 'Parent',
                            attributes: ['task_id', 'title']
                        },
                        {
                            model: User,
                            as: 'Creator',
                            attributes: ['user_id', 'role'],
                            include: [
                                { model: Student, attributes: ['name'] },
                                { model: Faculty, attributes: ['name'] },
                                { model: RoleUser, attributes: ['name'] },
                                { model: Staff, attributes: ['name'] }
                            ]
                        }
                    ]
                }
            ]
        });

        const result = {
            time_tasks: [],
            all_day: [],
            floating: []
        };

        assignments.forEach(assign => {
            const task = assign.Task;
            if (!task || !task.TaskTypes) return;

            task.TaskTypes.forEach(tt => {
                let creatorName = 'System';
                if (task.Creator) {
                    const u = task.Creator;
                    const profile = u.Student || u.Faculty || u.RoleUser || u.Staff;
                    if (profile) creatorName = profile.name;
                }

                const isLongTask = tt.task_name === 'Date-Only / Long Task' || tt.task_name === 'Long Task';
                const isFloating = tt.task_name === 'Floating Task';

                const formatted = {
                    task_id: task.task_id,
                    task: task.title,
                    status: assign.status,
                    assigned_by: creatorName,
                    priority: task.priority,
                    category: task.category,
                    start_date: tt.start_date,
                    end_date: tt.end_date,
                    start_time: isLongTask ? '08:45:00' : tt.start_time,
                    end_time: isLongTask ? '16:30:00' : tt.end_time,
                    task_name: tt.task_name,
                    parent_task_id: task.parent_task_id,
                    sub_tasks: []
                };

                if (isFloating) result.floating.push(formatted);
                else if (isLongTask) result.all_day.push(formatted);
                else result.time_tasks.push(formatted);
            });
        });

        // Helper: Nesting
        const buildCalendarTree = (flatTasks) => {
            const taskMap = {};
            const rootTasks = [];
            flatTasks.forEach(t => { taskMap[t.task_id] = t; });
            flatTasks.forEach(t => {
                if (t.parent_task_id && taskMap[t.parent_task_id]) {
                    taskMap[t.parent_task_id].sub_tasks.push(t);
                } else {
                    rootTasks.push(t);
                }
            });
            return rootTasks;
        };

        result.time_tasks = buildCalendarTree(result.time_tasks);
        result.all_day = buildCalendarTree(result.all_day);
        result.floating = buildCalendarTree(result.floating);

        // Optional: Sort time_tasks by time
        result.time_tasks.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// VENUE CALENDAR: Shows tasks occurring at venues where the user is an incharge
exports.getVenueCalendar = async (req, res) => {
    try {
        const userId = req.userId;
        const { date, venue_id } = req.query; // format 'YYYY-MM-DD'

        // 1. Verify the user is indeed an incharge of this venue (or ALL venues they own if venue_id not provided)
        const inchargeVenues = await RoleAssignment.findAll({
            where: { user_id: userId, venue_id: venue_id ? venue_id : { [Op.ne]: null } },
            attributes: ['venue_id']
        });

        const venueIds = inchargeVenues.map(ra => ra.venue_id);
        if (venueIds.length === 0) {
            return res.json([]); // Not an incharge or no venues found
        }

        let startOfDay, endOfDay;
        if (date) {
            startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
        } else {
            const now = new Date();
            startOfDay = new Date(now.setHours(0, 0, 0, 0));
            endOfDay = new Date(now.setHours(23, 59, 59, 999));
        }

        const tasks = await Task.findAll({
            where: {
                venue_id: { [Op.in]: venueIds },
                is_deleted: false,
                is_faculty: false // Exclude faculty tasks from venue calendar
            },
            include: [
                {
                    model: TaskType,
                    where: {
                        [Op.or]: [
                            { start_date: { [Op.between]: [startOfDay, endOfDay] } },
                            { end_date: { [Op.between]: [startOfDay, endOfDay] } },
                            {
                                [Op.and]: [
                                    { start_date: { [Op.lte]: startOfDay } },
                                    { end_date: { [Op.gte]: endOfDay } }
                                ]
                            }
                        ]
                    }
                },
                {
                    model: Task,
                    as: 'Parent',
                    attributes: ['task_id', 'title']
                },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name'] },
                        { model: Faculty, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] },
                        { model: Staff, attributes: ['name'] }
                    ]
                }
            ]
        });

        const result = {
            time_tasks: [],
            all_day: [],
            floating: []
        };

        tasks.forEach(task => {
            if (!task.TaskTypes) return;

            task.TaskTypes.forEach(tt => {
                let creatorName = 'System';
                if (task.Creator) {
                    const u = task.Creator;
                    const profile = u.Student || u.Faculty || u.RoleUser || u.Staff;
                    if (profile) creatorName = profile.name;
                }

                const isLongTask = tt.task_name === 'Date-Only / Long Task' || tt.task_name === 'Long Task';
                const isFloating = tt.task_name === 'Floating Task';

                const formatted = {
                    task_id: task.task_id,
                    task: task.title,
                    status: 'N/A',
                    assigned_by: creatorName,
                    priority: task.priority,
                    category: task.category,
                    start_date: tt.start_date,
                    end_date: tt.end_date,
                    start_time: isLongTask ? '08:45:00' : tt.start_time,
                    end_time: isLongTask ? '16:30:00' : tt.end_time,
                    venue_id: task.venue_id,
                    task_name: tt.task_name,
                    parent_task_id: task.parent_task_id,
                    sub_tasks: []
                };

                if (isFloating) result.floating.push(formatted);
                else if (isLongTask) result.all_day.push(formatted);
                else result.time_tasks.push(formatted);
            });
        });

        // Helper: Nesting
        const buildCalendarTree = (flatTasks) => {
            const taskMap = {};
            const rootTasks = [];
            flatTasks.forEach(t => { taskMap[t.task_id] = t; });
            flatTasks.forEach(t => {
                if (t.parent_task_id && taskMap[t.parent_task_id]) {
                    taskMap[t.parent_task_id].sub_tasks.push(t);
                } else {
                    rootTasks.push(t);
                }
            });
            return rootTasks;
        };

        result.time_tasks = buildCalendarTree(result.time_tasks);
        result.all_day = buildCalendarTree(result.all_day);
        result.floating = buildCalendarTree(result.floating);

        result.time_tasks.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
