const { Task, TaskType, TaskAssign, User, Student, Faculty, RoleUser, Staff } = require('../models');
const { Op } = require('sequelize');

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
                    include: [
                        {
                            model: TaskType,
                            where: {
                                [Op.or]: [
                                    {
                                        start_date: {
                                            [Op.between]: [startOfDay, endOfDay]
                                        }
                                    },
                                    {
                                        end_date: {
                                            [Op.between]: [startOfDay, endOfDay]
                                        }
                                    },
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

        const calendarTasks = [];

        assignments.forEach(assign => {
            const task = assign.Task;
            if (!task || !task.TaskTypes) return;

            task.TaskTypes.forEach(tt => {
                // Get creator name
                let creatorName = 'System';
                if (task.Creator) {
                    const u = task.Creator;
                    const profile = u.Student || u.Faculty || u.RoleUser || u.Staff;
                    if (profile) creatorName = profile.name;
                }

                // Format time interval
                let timeStr = 'N/A';
                if (tt.start_date && tt.end_date) {
                    const st = new Date(tt.start_date);
                    const et = new Date(tt.end_date);

                    const stStr = st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                    const etStr = et.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

                    timeStr = `${stStr} - ${etStr}`;
                } else if (tt.task_name) {
                    timeStr = tt.task_name;
                }

                calendarTasks.push({
                    task_id: task.task_id,
                    task: task.title,
                    time: timeStr,
                    status: assign.status,
                    assigned_by: creatorName,
                    priority: task.priority,
                    category: task.category,
                    start_date: tt.start_date,
                    end_date: tt.end_date
                });
            });
        });

        // Sort by start_date for chronological order
        calendarTasks.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

        res.json(calendarTasks);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
