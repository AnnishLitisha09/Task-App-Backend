const { Staff, User } = require('./models');

async function test() {
    try {
        const staffs = await Staff.findAll();
        for (const s of staffs) {
            const u = await User.findByPk(s.user_id);
            if (!u) {
                console.log(`Staff ${s.id} (user_id: ${s.user_id}) has NO valid User record! Missing in DB!`);
            } else {
                console.log(`Staff ${s.id} (user_id: ${s.user_id}) is valid, Role=${u.role}`);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
test();
