const { Task, TaskType, TaskAssign, User, Student, Faculty, Staff, RoleUser, TaskPackageClosure, TaskClosure, TaskLog, TaskEscalation, Venue } = require('./models');

async function verifyExhaustive() {
    try {
        console.log('--- Fetching Sample Task for Exhaustive Details ---');
        // Find a task that hopefully has some assignments or logs
        const taskObj = await Task.findOne({
            where: { is_deleted: false },
            order: [['task_id', 'DESC']]
        });

        if (!taskObj) {
            console.log('No tasks found in DB to test.');
            return;
        }

        const id = taskObj.task_id;
        console.log(`Testing with Task ID: ${id}`);

        const task = await Task.findOne({
            where: { task_id: id, is_deleted: false },
            include: [
                { 
                    model: User, 
                    as: 'Creator', 
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name'] },
                        { model: Faculty, attributes: ['name'] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                },
                { 
                    model: User, 
                    as: 'Approver', 
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name'] },
                        { model: Faculty, attributes: ['name'] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                },
                { model: TaskType },
                { model: Venue, attributes: ['id', 'name', 'location'] },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskAssign,
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
                },
                {
                    model: TaskLog,
                    include: [{ 
                        model: User, 
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }],
                    required: false
                },
                {
                    model: TaskEscalation,
                    include: [
                        { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                        { model: User, as: 'RejectedUser', attributes: ['user_id', 'role'] }
                    ],
                    required: false
                }
            ]
        });

        if (!task) {
            console.log('Task fetched but then not found on detailed query.');
            return;
        }

        // Helper to format User profiles
        const formatUser = (user) => {
            if (!user) return null;
            const profile = user.Student || user.Faculty || user.Staff || user.RoleUser || {};
            return {
                user_id: user.user_id,
                role: user.role,
                name: profile.name || 'Unknown'
            };
        };

        const formattedTask = {
            task_info: {
                task_id: task.task_id,
                title: task.title,
                status: task.status,
            },
            people: {
                creator: formatUser(task.Creator),
                approver: formatUser(task.Approver)
            },
            assignments_count: task.TaskAssigns?.length || 0,
            first_assignee: task.TaskAssigns?.[0] ? formatUser(task.TaskAssigns[0].User) : null,
            logs_count: task.TaskLogs?.length || 0,
            first_log: task.TaskLogs?.[0] ? { action: task.TaskLogs[0].action, actor: formatUser(task.TaskLogs[0].User) } : null,
            escalations_count: task.TaskEscalations?.length || 0
        };

        console.log('\n--- Formatted Result Preview ---');
        console.log(JSON.stringify(formattedTask, null, 2));

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        process.exit();
    }
}

verifyExhaustive();
