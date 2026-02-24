const db = require('./models');
db.sequelize.query('INSERT IGNORE INTO SequelizeMeta (name) VALUES ("20260217210500-add-is-paused-to-tasks.js")')
    .then(() => {
        console.log("Migration marked as applied successfully");
        process.exit(0);
    })
    .catch(err => {
        console.error("Error marking migration:", err);
        process.exit(1);
    });
