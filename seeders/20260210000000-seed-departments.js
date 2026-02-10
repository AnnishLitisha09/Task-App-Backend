'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const departments = [
      'Biomedical Engineering',
      'Civil Engineering',
      'Computer Science & Design',
      'Computer Science & Engineering',
      'Electrical & Electronics Engineering',
      'Electronics & Communication Engineering',
      'Electronics & Instrumentation Engineering',
      'Information Science & Engineering',
      'Mechanical Engineering',
      'Mechatronics Engineering',
      'Agricultural Engineering',
      'Artificial Intelligence and Data Science',
      'Artificial Intelligence and Machine Learning',
      'Biotechnology',
      'Computer Science & Business Systems',
      'Computer Technology',
      'Food Technology',
      'Fashion Technology',
      'Information Technology',
      'Textile Technology'
    ];

    const departmentData = departments.map(name => ({
      name,
      created_at: new Date(),
      updated_at: new Date()
    }));

    await queryInterface.bulkInsert('departments', departmentData);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('departments', null, {});
  }
};
