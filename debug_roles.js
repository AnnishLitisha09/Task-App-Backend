const { Role } = require('./models');

async function listRoles() {
    try {
        const roles = await Role.findAll();
        console.log("Available Roles:", roles.map(r => r.user_role));
    } catch (error) {
        console.error("Error:", error);
    }
}

listRoles();
