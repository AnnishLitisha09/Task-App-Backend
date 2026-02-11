'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.bulkInsert('resources', [
            {
                name: 'Laptop',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Projector',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Vehicle',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Software',
                created_at: new Date(),
                updated_at: new Date()
            }
        ]);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('resources', {
            name: ['Laptop', 'Projector', 'Vehicle', 'Software']
        });
    }
};
