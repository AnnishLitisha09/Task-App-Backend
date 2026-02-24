'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`ALTER TABLE tasks MODIFY COLUMN status ENUM('Active', 'Expired', 'Completed', 'Paused', 'Inactive') DEFAULT 'Active'`);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`ALTER TABLE tasks MODIFY COLUMN status ENUM('Active', 'Expired', 'Completed', 'Inactive') DEFAULT 'Active'`);
    }
};
