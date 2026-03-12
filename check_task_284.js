const { Task, Faculty, User } = require('./models');

async function checkTask() {
  try {
    const taskId = 284;
    const userId = 40;

    const task = await Task.findByPk(taskId);
    if (!task) {
      console.log('Task not found');
      return;
    }

    console.log(`Task ${taskId} Details:`);
    console.log(`- Creator ID: ${task.creator_id}`);
    console.log(`- Is Faculty: ${task.is_faculty}`);
    console.log(`- Faculty ID: ${task.faculty_id}`);

    const user40 = await User.findByPk(userId, { include: [Faculty] });
    console.log(`User ${userId} Details:`);
    console.log(`- Role: ${user40?.role}`);
    console.log(`- Faculty Entry ID: ${user40?.Faculty?.id}`);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkTask();
