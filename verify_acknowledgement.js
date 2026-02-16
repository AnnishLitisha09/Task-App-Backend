const { User, Task, TaskAssign, TaskAcknowledgment, TaskEscalation, Role, RoleAssignment, Student } = require('./models');
const { Op } = require('sequelize');

async function runVerification() {
    console.log('--- Starting Verification of Acknowledgement & Escalation ---');

    try {
        const today = new Date().toISOString().split('T')[0];

        // 1. Check Acknowledgement Report Logic
        console.log('\n1. Verifying Acknowledgement Report Logic...');
        const users = await User.findAll({
            where: { role: { [Op.ne]: 'admin' }, status: 'active' },
            limit: 5 // Sample
        });

        const todaysAcks = await TaskAcknowledgment.findAll({
            where: { acknowledge_date: today, acknowledged_at: { [Op.ne]: null } }
        });

        console.log(`Found ${users.length} active users and ${todaysAcks.length} acknowledgments for today.`);

        // 2. Test Rejection Escalation Trigger
        console.log('\n2. Testing Rejection Escalation Trigger...');
        // Find a pending task to reject (mocking the context)
        const pendingAssignment = await TaskAssign.findOne({
            where: { status: 'pending' },
            include: [{ model: Task }]
        });

        if (pendingAssignment) {
            console.log(`Simulating rejection for Task ID: ${pendingAssignment.task_id} by User ID: ${pendingAssignment.user_id}`);

            // This is what our controller does:
            const reason = "Testing escalation logic - Rejecting for verification";

            // Start transaction
            const t = await Task.sequelize.transaction();
            try {
                // Update assignment
                await pendingAssignment.update({
                    status: 'rejected',
                    reason: reason,
                    rejected_at: new Date()
                }, { transaction: t });

                // Create escalation
                const escalation = await TaskEscalation.create({
                    task_id: pendingAssignment.task_id,
                    reason: reason,
                    creator_id: pendingAssignment.Task.creator_id,
                    rejected_user_id: pendingAssignment.user_id,
                    status: 'pending'
                }, { transaction: t });

                await t.commit();
                console.log(`✅ TaskEscalation record created successfully: ID ${escalation.id}`);
            } catch (e) {
                await t.rollback();
                console.error('❌ Failed to create escalation:', e.message);
            }
        } else {
            console.log('No pending assignments found to test rejection escalation.');
        }

        // 3. Verify Data categorized by Role (Check if RoleAssignment works)
        console.log('\n3. Verifying Role-based categorization...');
        const roleUsers = await User.findAll({
            where: { role: 'role-user' },
            include: [{
                model: RoleAssignment,
                include: [{ model: Role }]
            }],
            limit: 3
        });

        roleUsers.forEach(u => {
            const roles = u.RoleAssignments?.map(ra => ra.Role?.user_role) || [];
            console.log(`User ${u.user_id} has roles: ${roles.join(', ') || 'None'}`);
        });

    } catch (error) {
        console.error('Verification Error:', error);
    } finally {
        process.exit();
    }
}

runVerification();
