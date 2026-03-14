const { User, Student, TaskAssign, Task, TaskType } = require('./models');

async function debugUserStats() {
    const userId = 33;
    try {
        console.log(`--- Debugging Stats for User ${userId} ---`);
        
        const user = await User.findByPk(userId);
        if (!user) { console.log('User not found'); return; }
        
        const student = await Student.findOne({ where: { user_id: userId } });
        console.log('Profile Data (Student):', JSON.stringify({
            score: student?.score,
            total_score: student?.total_score,
            penalty: student?.penalty
        }, null, 2));

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'completed' },
            include: [{ model: Task, include: [{ model: TaskType }] }]
        });

        console.log(`\nCompleted Assignments Count: ${assignments.length}`);
        let sumBase = 0;
        let sumEarned = 0;
        let sumPenalty = 0;

        assignments.forEach(a => {
            const base = parseFloat(a.Task?.score || 0);
            const earned = parseFloat(a.earned_score || 0);
            const penalty = parseFloat(a.penalty_applied || 0);
            
            console.log(`Task ${a.task_id}: "${a.Task?.title}" - Base: ${base}, Earned: ${earned}, Penalty: ${penalty}`);
            sumBase += base;
            sumEarned += earned;
            sumPenalty += penalty;
        });

        console.log('\nCalculated Totals from Assignments:');
        console.log(`Sum Base Score: ${sumBase}`);
        console.log(`Sum Earned Score: ${sumEarned}`);
        console.log(`Sum Penalty: ${sumPenalty}`);
        
        console.log('\nDiscrepancy Check:');
        console.log(`Total Score Diff: ${parseFloat(student?.total_score || 0) - sumBase}`);
        console.log(`Earned Score Diff: ${parseFloat(student?.score || 0) - sumEarned}`);
        console.log(`Penalty Diff: ${parseFloat(student?.penalty || 0) - sumPenalty}`);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

debugUserStats();
