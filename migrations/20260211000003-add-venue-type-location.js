'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('venues', 'venue_type', {
            type: Sequelize.ENUM('class', 'auditorium', 'seminar hall', 'conference room', 'others'),
            allowNull: true,
            defaultValue: 'others',
            after: 'name'
        });

        await queryInterface.addColumn('venues', 'location', {
            type: Sequelize.STRING(100),
            allowNull: true,
            after: 'venue_type'
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn('venues', 'location');
        await queryInterface.removeColumn('venues', 'venue_type');
        // Drop ENUM type
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_venues_venue_type";');
    }
};
