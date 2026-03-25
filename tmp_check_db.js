const { Task, TaskAssign, TaskType } = require('./models');

async function check() {
    try {
        const tasks = await Task.findAll({
            order: [['task_id', 'DESC']],
            limit: 5,
            include: [TaskType, TaskAssign]
        });

        tasks.forEach(t => {
            console.log(`ID: ${t.task_id} | Title: ${t.title} | Status: ${t.status} | Parent: ${t.parent_task_id} | Seq: ${t.sequence_order}`);
            t.TaskAssigns.forEach(a => {
                console.log(`  -> Assignee: ${a.user_id} | Status: ${a.status}`);
            });
            if (t.TaskTypes?.[0]) {
                const tt = t.TaskTypes[0];
                console.log(`  -> Start: ${tt.start_date} ${tt.start_time} | End: ${tt.end_date} ${tt.end_time} | Max: ${tt.max_duration_hours}`);
            }
        });
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

check();
