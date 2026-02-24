const router = require("express").Router();
const auth = require("../controllers/authController");

const { verifyToken } = require("../middlewares/auth.middleware");

router.post("/create-admin", auth.createAdmin);
router.post("/login", auth.login);
router.post("/google", auth.googleLogin);
router.get("/context", verifyToken, auth.getUserContext);

module.exports = router;
