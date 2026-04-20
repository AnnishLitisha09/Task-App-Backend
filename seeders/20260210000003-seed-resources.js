'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.bulkInsert('resources', [
            {
                name: 'Laptop',
                description: 'High-performance laptop for development and presentations.',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Projector',
                description: '4K projector for seminar halls and conference rooms.',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Vehicle',
                description: 'College bus or van for transportation.',
                created_at: new Date(),
                updated_at: new Date()
            },
            {
                name: 'Software',
                description: 'Licensed software for academic or administrative use.',
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
