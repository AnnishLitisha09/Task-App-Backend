'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`ALTER TABLE tasks MODIFY COLUMN status ENUM('Active', 'Expired', 'Completed', 'Paused') DEFAULT 'Active'`);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`ALTER TABLE tasks MODIFY COLUMN status ENUM('Active', 'Expired', 'Completed') DEFAULT 'Active'`);
    }
};
