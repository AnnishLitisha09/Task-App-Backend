const { Task, TaskType, TaskAssign, User, Student, Faculty, Staff, RoleUser, TaskPackageClosure, TaskClosure, TaskLog, TaskEscalation, Venue, Department, RoleAssignment, Role, TaskApprovalRequest } = require('./models');

async function verifyExhaustiveV2() {
    try {
        console.log('--- Fetching Sample Task for Exhaustive Details V2 ---');
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

        // Mocking the request/response for the controller function
        const req = { params: { id } };
        const res = {
            json: (data) => {
                console.log('\n--- Enhanced Formatted Result Preview ---');
                console.log(JSON.stringify(data, null, 2));
                
                // Detailed check
                console.log('\n--- Validation Checks ---');
                console.log('Execution Status:', data.task_info.execution_status);
                console.log('Grouped Assignees:', Object.keys(data.assignees.grouped));
                console.log('Transfer History Count:', data.transfer_history.length);
                console.log('Approval Detail Status:', data.approval_detail?.status);
                if (data.venue) {
                    console.log('Venue Incharges Count:', data.venue.incharges?.length);
                }
            },
            status: (code) => ({
                json: (data) => console.log(`Error Response (${code}):`, data)
            })
        };

        const taskController = require('./controllers/task.controller');
        await taskController.getExhaustiveTaskDetails(req, res);

    } catch (err) {
        console.error('Test failed:', err);
    } finally {
        process.exit();
    }
}

verifyExhaustiveV2();
