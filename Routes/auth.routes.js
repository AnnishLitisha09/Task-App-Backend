const router = require("express").Router();
const auth = require("../controllers/authController");

const { verifyToken, isAdmin } = require("../middlewares/auth.middleware");

router.post("/create-admin", auth.createAdmin);
router.post("/login", auth.login);
router.post("/google", auth.googleLogin);
router.get("/context", verifyToken, auth.getUserContext);
router.post("/logout", verifyToken, auth.logout);
router.post("/admin/logout/:userId", verifyToken, isAdmin, auth.adminLogoutUser);

module.exports = router;
