'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.bulkInsert('task_closure', [
            {
                name: 'otp',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'photo_upload',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'qr_scanner',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'documentation',
                created_at: new Date(),
                updated_at: new Date()
            }
        ]);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('task_closure', {
            name: ['otp', 'photo_upload', 'qr_scanner', 'documentation']
        });
    }
};
