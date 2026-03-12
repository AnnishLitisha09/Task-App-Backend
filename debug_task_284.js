
const { Task, TaskAssign, TaskType, TaskApprovalRequest } = require('./models');

async function debugTask() {
    try {
        const taskId = 284;
        const userId = 40;

        const task = await Task.findByPk(taskId);
        const taskType = await TaskType.findOne({ where: { task_id: taskId } });
        const assignment = await TaskAssign.findOne({ where: { task_id: taskId, user_id: userId } });
        const approvalRequest = await TaskApprovalRequest.findOne({
            where: {
                [require('sequelize').Op.or]: [
                    { task_id: taskId },
                    { task_ids: { [require('sequelize').Op.like]: `%${taskId}%` } }
                ]
            }
        });

        console.log('--- RESULTS ---');
        console.log('TID:', taskId);
        console.log('UID:', userId);
        console.log('TASK_STATUS:', task ? task.status : 'NOT_FOUND');
        console.log('TASK_IS_APPROVED:', task ? task.is_approved : 'N/A');
        console.log('TASK_FACULTY_ID:', task ? task.faculty_id : 'N/A');
        console.log('ASSIGNMENT_STATUS:', assignment ? assignment.status : 'NOT_FOUND');
        console.log('ASSIGNMENT_ID:', assignment ? assignment.id : 'N/A');
        console.log('TASK_TYPE_NAME:', taskType ? taskType.task_name : 'NOT_FOUND');
        console.log('APPROVAL_STATUS:', approvalRequest ? approvalRequest.status : 'NOT_FOUND');
        console.log('--- END ---');

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugTask();
