const { getTaskDetailsById } = require('./controllers/task.controller');

async function testApi() {
    const req = { params: { id: 1 } }; // Assuming task ID 1 exists
    const res = {
        status: (code) => {
            console.log(`Status: ${code}`);
            return res;
        },
        json: (data) => console.log(JSON.stringify(data, null, 2))
    };

    console.log("Testing getTaskDetailsById(1)...");
    await getTaskDetailsById(req, res);
    process.exit(0);
}

testApi();
