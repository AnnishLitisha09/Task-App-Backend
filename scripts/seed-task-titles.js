'use strict';
const { TaskTitle } = require('../models');

const seedData = [
    // Faculty/Staff Tasks
    { task_title: 'Lecture Handling', target_role: 'faculty' },
    { task_title: 'Practical Session', target_role: 'faculty' },
    { task_title: 'Lab Exercise Supervision', target_role: 'faculty' },
    { task_title: 'PBL (Project Based Learning)', target_role: 'faculty' },
    { task_title: 'Assignment Evaluation', target_role: 'faculty' },
    { task_title: 'Record Verification', target_role: 'faculty' },
    { task_title: 'Internal Assessment Work', target_role: 'faculty' },
    { task_title: 'Question Paper Preparation', target_role: 'faculty' },
    { task_title: 'Internal Exam Duty', target_role: 'faculty' },
    { task_title: 'Semester Exam Invigilation', target_role: 'faculty' },
    { task_title: 'Practical Exam Examiner', target_role: 'faculty' },
    { task_title: 'Paper Valuation', target_role: 'faculty' },
    { task_title: 'Exam Coordination', target_role: 'faculty' },
    { task_title: 'Hall Supervision', target_role: 'faculty' },
    { task_title: 'Mentor Meeting', target_role: 'faculty' },
    { task_title: 'Student Counseling', target_role: 'faculty' },
    { task_title: 'Academic Review Meeting', target_role: 'faculty' },
    { task_title: 'Attendance Review', target_role: 'faculty' },
    { task_title: 'Progress Monitoring', target_role: 'faculty' },
    { task_title: 'Meeting (Department / College)', target_role: 'faculty' },
    { task_title: 'Report Submission', target_role: 'faculty' },
    { task_title: 'Documentation Work', target_role: 'faculty' },
    { task_title: 'Committee Work', target_role: 'faculty' },
    { task_title: 'Permission Approval', target_role: 'faculty' },
    { task_title: 'Lab Maintenance Checking', target_role: 'faculty' },
    { task_title: 'Equipment Verification', target_role: 'faculty' },
    { task_title: 'Venue Checking', target_role: 'faculty' },
    { task_title: 'Infrastructure Inspection', target_role: 'faculty' },
    { task_title: 'Special Lab Supervision', target_role: 'faculty' },
    { task_title: 'Library Duty', target_role: 'faculty' },
    { task_title: 'Book Verification', target_role: 'faculty' },
    { task_title: 'Resource Management', target_role: 'faculty' },
    { task_title: 'Discipline Duty', target_role: 'faculty' },
    { task_title: 'Campus Monitoring', target_role: 'faculty' },
    { task_title: 'Event Discipline Management', target_role: 'faculty' },

    // Student Tasks
    { task_title: 'Lab Exercise', target_role: 'student' },
    { task_title: 'Practical Session (Student)', target_role: 'student' },
    { task_title: 'Special Lab', target_role: 'student' },
    { task_title: 'PBL Work', target_role: 'student' },
    { task_title: 'Core Subject Training', target_role: 'student' },
    { task_title: 'PS Skill Training', target_role: 'student' },
    { task_title: 'UAL Activities', target_role: 'student' },
    { task_title: 'PT Exam', target_role: 'student' },
    { task_title: 'Internal Assessment', target_role: 'student' },
    { task_title: 'Semester Exam', target_role: 'student' },
    { task_title: 'Practical Exam', target_role: 'student' },
    { task_title: 'Mentor Meeting (Student)', target_role: 'student' },
    { task_title: 'SSG Meeting', target_role: 'student' },
    { task_title: 'Academic Review Session', target_role: 'student' },
    { task_title: 'Placement Training', target_role: 'student' },
    { task_title: 'External Training', target_role: 'student' },
    { task_title: 'Internal Training', target_role: 'student' },
    { task_title: 'Skill Development Programs', target_role: 'student' }
];

async function seed() {
    try {
        for (const item of seedData) {
            await TaskTitle.findOrCreate({
                where: { task_title: item.task_title },
                defaults: { target_role: item.target_role }
            });
        }
        console.log('TaskTitles seeded successfully');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

seed();
