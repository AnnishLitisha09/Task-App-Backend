const { User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, TaskAssign } = require('./models');
const { canAssignTo } = require('./controllers/task.assignment');

// Mock Data provided by user
const payload = {
    title: "Debug Task",
    assignee_ids: [40], // The problematic ID
    assign_to_groups: [{ "role": "FACULTY", "department_id": 5 }] // The problematic Group
};

async function debug() {
    console.log('--- START DEBUGGING TASK CREATION ---');
    try {
        // 1. Identify valid users to simulate
        // We try to find an Admin and a Faculty to test permissions for both
        const admin = await User.findOne({ where: { role: 'admin' } });
        const faculty = await User.findOne({ where: { role: 'faculty' } });

        // 2. Run Simulations
        if (admin) {
            console.log(`\n\n=== SCENARIO 1: Simulating as ADMIN (User ID: ${admin.user_id}) ===`);
            await simulateCreation(admin.user_id, 'admin');
        } else {
            console.log('\n(Skipped Admin simulation: No admin user found)');
        }

        if (faculty) {
            console.log(`\n\n=== SCENARIO 2: Simulating as FACULTY (User ID: ${faculty.user_id}) ===`);
            await simulateCreation(faculty.user_id, 'faculty');
        } else {
            console.log('\n(Skipped Faculty simulation: No faculty user found)');
        }

    } catch (e) {
        console.error('CRITICAL ERROR In Debug Script:', e);
    }
}

async function simulateCreation(userId, userRole) {
    console.log(`Creator: User ${userId} (${userRole})`);

    // --- Logic from createUnifiedTask ---
    let finalAssigneeIds = [];

    // 1. Resolve assign_to_groups
    if (payload.assign_to_groups) {
        console.log(`Processing Groups: ${JSON.stringify(payload.assign_to_groups)}`);
        for (const group of payload.assign_to_groups) {
            let users = [];
            const { role, department_id } = group;
            console.log(`  - Checking group Role: ${role}, Dept: ${department_id}`);

            if (role === 'STUDENT') {
                users = await Student.findAll({ where: department_id ? { department_id } : {} });
            } else if (role === 'FACULTY') {
                users = await Faculty.findAll({ where: department_id ? { department_id } : {} });
            } else if (role === 'HOD') {
                // Simplified for debug
                const hodRole = await Role.findOne({ where: { user_role: 'HOD' } });
                if (hodRole) users = await RoleAssignment.findAll({ where: { role_id: hodRole.role_id, ...(department_id && { department_id }) } });
            } else if (role === 'STAFF') {
                users = await Staff.findAll();
            } else {
                console.log(`    ! Check logic for custom role ${role}`);
            }

            console.log(`    > Found ${users.length} users in this group.`);
            if (users.length > 0) {
                console.log(`    > First user in group: GroupUser ID ${users[0].user_id}`);
            }

            users.forEach(u => {
                if (u.user_id && !finalAssigneeIds.includes(u.user_id)) finalAssigneeIds.push(u.user_id);
            });
        }
    }

    // 2. Resolve assignee_ids
    if (payload.assignee_ids) {
        console.log(`Processing Specific IDs: ${JSON.stringify(payload.assignee_ids)}`);
        payload.assignee_ids.forEach(id => {
            if (id && !finalAssigneeIds.includes(id)) finalAssigneeIds.push(id);
        });
    }

    console.log(`\nPotential Assignees (Candidates): ${JSON.stringify(finalAssigneeIds)}`);

    // 3. Check Permissions (The assignment loop)
    const assignments = [];
    console.log('Checking Permissions (canAssignTo)...');

    for (const assigneeId of finalAssigneeIds) {
        try {
            // VERIFY USER EXISTS FIRST (To catch the "Unknown ID" error that rolls back transaction)
            const exists = await User.findByPk(assigneeId);
            if (!exists) {
                console.error(`  [ERROR] User ID ${assigneeId} DOES NOT EXIST! This would cause the entire creation to FAIL (Rollback).`);
                continue;
            }

            const allowed = await canAssignTo(userId, assigneeId);
            console.log(`  - Assigning to User ${assigneeId}: ${allowed ? 'ALLOWED' : 'DENIED'}`);

            if (allowed) {
                assignments.push({ user_id: assigneeId, status: 'pending' });
            }
        } catch (error) {
            console.error(`  [ERROR] Exception checking User ${assigneeId}:`, error.message);
        }
    }

    console.log(`\nFinal Valid Assignments Count: ${assignments.length}`);
    if (assignments.length === 0) {
        console.log('  -> RESULT: Task would be created but NO assignments made (Task Assign Table Empty).');
    } else {
        console.log('  -> RESULT: Assignments would be inserted.');
    }
}

debug();
