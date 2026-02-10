const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, AuthAccount } = require("../models");

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
exports.createAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      role: "ADMIN",
      status: "ACTIVE"
    });

    await AuthAccount.create({
      user_id: user.user_id,
      email,
      hashed_password: hash
    });

    res.json({ message: "Admin created successfully" });

  } catch (err) {
    console.error("CREATE ADMIN ERROR 👉", err);
    res.status(500).json({
      message: "Create admin failed",
      error: err.message
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const account = await AuthAccount.findOne({
      where: { email },
      include: [{
        model: User,
        attributes: ["user_id", "role", "status"]
      }]
    });

    if (!account || !account.User) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, account.hashed_password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        user_id: account.User.user_id,
        role: account.User.role
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user_id: account.User.user_id,
      role: account.User.role
    });

  } catch (err) {
    console.error("LOGIN ERROR 👉", err);
    res.status(500).json({ message: err.message });
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    // Verify Google ID token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const { email } = ticket.getPayload();

    // Find account created by admin
    const account = await AuthAccount.findOne({
      where: { email, deleted_at: null },
      include: { model: User, attributes: ["user_id", "role", "status"] }
    });

    if (!account || !account.User) {
      return res.status(403).json({ message: "Account not created by admin" });
    }

    // Generate JWT
    const jwtToken = jwt.sign(
      { user_id: account.User.user_id, role: account.User.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    // Return consistent response
    res.json({
      token: jwtToken,
      user_id: account.User.user_id,
      role: account.User.role
    });
  } catch (err) {
    console.error("GOOGLE LOGIN ERROR 👉", err);
    res.status(401).json({ message: "Invalid Google token" });
  }
};