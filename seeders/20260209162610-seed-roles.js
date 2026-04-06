'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('roles', [
      {
        user_role: 'HOD',
        scope_id: 3, // Department
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        user_role: 'PRINCIPAL',
        scope_id: 2, // Institution
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('roles', {
      user_role: [
        'HOD',
        'LIBRARY_INCHARGE',
        'DOCUMENTATION_INCHARGE',
        'SEMINAR_HALL_INCHARGE',
        'TRANSPORT_INCHARGE'
      ]
    });
  }
};
