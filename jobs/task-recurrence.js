const { Task, TaskType, TaskAssign } = require('../models');
const { Op } = require('sequelize');

/**
 * Task Recurrence Handler
 * Logic:
 * 1. Find all Active tasks with a recurrence pattern.
 * 2. Check if the task's end_date has passed (meaning it's time for the next occurrence).
 * 3. If it has, create a NEW task instance for the next period.
 * 4. Mark the old task as Inactive? (Or leave it Active if multiple occurrences can coexist).
 *    Usually, for recurrence, we spawn the next one and keep the history.
 */
exports.handleRecurrence = async () => {
    try {
        console.log('[CRON] Running task recurrence check...');

        const tasks = await Task.findAll({
            where: { status: 'Active', is_deleted: false },
            include: [{
                model: TaskType,
                where: {
                    recurrence: { [Op.ne]: 'none' },
                    end_date: { [Op.lt]: new Date() } // Occurrence has ended
                }
            }]
        });

        let spawnedCount = 0;

        for (const task of tasks) {
            const taskType = task.TaskTypes[0]; // Assuming one type per task for now as per controller logic

            // Calculate next dates
            const nextStartDate = new Date(taskType.start_date);
            const nextEndDate = new Date(taskType.end_date);

            if (taskType.recurrence === 'daily') {
                nextStartDate.setDate(nextStartDate.getDate() + 1);
                nextEndDate.setDate(nextEndDate.getDate() + 1);
            } else if (taskType.recurrence === 'weekly') {
                nextStartDate.setDate(nextStartDate.getDate() + 7);
                nextEndDate.setDate(nextEndDate.getDate() + 7);
            } else if (taskType.recurrence === 'monthly') {
                nextStartDate.setMonth(nextStartDate.getMonth() + 1);
                nextEndDate.setMonth(nextEndDate.getMonth() + 1);
            }

            // Check if we already spawned this next occurrence
            // (heuristic: same title and same start date)
            const exists = await Task.findOne({
                where: { title: task.title, creator_id: task.creator_id },
                include: [{
                    model: TaskType,
                    where: { start_date: nextStartDate }
                }]
            });

            if (!exists) {
                // Spawn new task
                const t = await Task.sequelize.transaction();
                try {
                    const newTask = await Task.create({
                        ...task.toJSON(),
                        task_id: undefined, // Let it auto-increment
                        status: 'Active',
                        created_at: new Date(),
                    }, { transaction: t });

                    await TaskType.create({
                        ...taskType.toJSON(),
                        id: undefined,
                        task_id: newTask.task_id,
                        start_date: nextStartDate,
                        end_date: nextEndDate,
                    }, { transaction: t });

                    // Optional: Re-assign to the same users if needed?
                    // For now, keep it simple. The creator might want to re-assign manually or we can copy assignments.
                    const assignments = await TaskAssign.findAll({ where: { task_id: task.task_id } });
                    for (const assign of assignments) {
                        await TaskAssign.create({
                            task_id: newTask.task_id,
                            user_id: assign.user_id,
                            status: 'pending'
                        }, { transaction: t });
                    }

                    // Mark old task as Inactive to avoid re-processing or confusion
                    await task.update({ status: 'Inactive' }, { transaction: t });

                    await t.commit();
                    spawnedCount++;
                    console.log(`[CRON] Spawned next occurrence for task: ${task.title}`);
                } catch (err) {
                    await t.rollback();
                    console.error(`[CRON ERROR] Failed to spawn task ${task.task_id}:`, err.message);
                }
            }
        }

        console.log(`[CRON] Recurrence check completed. ${spawnedCount} tasks spawned.`);
        return { spawned: spawnedCount };

    } catch (error) {
        console.error('[CRON ERROR] handleRecurrence:', error.message);
        return { error: error.message };
    }
};
