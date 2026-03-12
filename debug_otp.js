const { sequelize, Task, TaskPackageClosure, TaskClosure } = require('./models');

async function debug() {
  try {
    // 1. Check Schema
    console.log('--- Table Schema: task_otps ---');
    const [columns] = await sequelize.query('SHOW COLUMNS FROM task_otps');
    console.log(JSON.stringify(columns, null, 2));

    // 2. Check Tasks
    console.log('\n--- Task Details (284, 289) ---');
    const tasks = await Task.findAll({
      where: { task_id: [284, 289] },
      include: [{ 
        model: TaskPackageClosure, 
        include: [{ model: TaskClosure, attributes: ['name'] }] 
      }]
    });
    
    tasks.forEach(task => {
      console.log(`Task ID: ${task.task_id}`);
      console.log(`Title: ${task.title}`);
      console.log(`Requires OTP: ${task.TaskPackageClosures.some(c => c.TaskClosure?.name === 'otp')}`);
      console.log(`Closures: ${task.TaskPackageClosures.map(c => c.TaskClosure?.name).join(', ')}`);
      console.log('-------------------');
    });

  } catch (err) {
    console.error('DEBUG ERROR:', err);
  } finally {
    process.exit();
  }
}

debug();
