'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        const venues = [
            { name: 'Main Auditorium', image_url: '/uploads/venues/Main_auditorium.jpg' },
            { name: 'Seminar Hall 1', image_url: '/uploads/venues/seminar_hall_1.jpg' },
            { name: 'Seminar Hall 2', image_url: '/uploads/venues/seminar_hall_2.jpg' },
            { name: 'Seminar Hall 3', image_url: '/uploads/venues/seminar_hall_3.jpg' },
            { name: 'Lab', image_url: '/uploads/venues/lab.jpg' },
            { name: 'Library', image_url: '/uploads/venues/Library.jpg' },

        ];

        const venueData = venues.map(venue => ({
            ...venue,
            created_at: new Date(),
            updated_at: new Date()
        }));

        await queryInterface.bulkInsert('venues', venueData, {
            updateOnDuplicate: ['name', 'image_url', 'updated_at']
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.bulkDelete('venues', null, {});
    }
};
