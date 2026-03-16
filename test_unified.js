const taskController = require('./controllers/task.controller');

async function testApi() {
    const req = {
        userId: 1, // Admin user ID usually 1
        userRole: 'admin',
        body: {
            task_title_id: 1,
            description: "Test All Staff Assignment",
            category: "Administrative",
            priority: "medium",
            origin_type: "directive",
            venue_id: 1,
            score: 10,
            is_mandatory: false,
            is_package: false,
            is_document: true,
            closure_ids: [1],
            task_type_data: {
                task_name: "Fixed Time Task",
                start_date: "2026-03-20",
                end_date: "2026-03-20",
                start_time: "09:00:00",
                end_time: "17:00:00"
            },
            assignee_ids: [8, 23, 41, 71] // Mocking Staff IDs 8, 23, 41, 71
        }
    };

    const res = {
        status: function(code) {
            console.log("Status called:", code);
            return this;
        },
        json: function(data) {
            console.log("JSON called:", JSON.stringify(data, null, 2));
        }
    };

    try {
        await taskController.createUnifiedTask(req, res);
    } catch (e) {
        console.error("Test Error:", e);
    }
}
testApi();
