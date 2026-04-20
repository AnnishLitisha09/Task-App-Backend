const jwt = require('jsonwebtoken');
const { User, AuthAccount } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET;

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided!' });
    }

    // Formatting: "Bearer <token>"
    const tokenParts = token.split(' ');
    const tokenValue = tokenParts.length === 2 ? tokenParts[1] : token;

    jwt.verify(tokenValue, JWT_SECRET, async (err, decoded) => {
        if (err) {
            console.warn(`[AUTH] JWT Verification Failed: ${err.message}`);
            return res.status(401).json({ message: 'Unauthorized: Invalid or expired token.' });
        }

        try {
            // --- NEW: Strict Single-Device Session Check ---
            const account = await AuthAccount.findByPk(decoded.user_id);
            if (!account || !account.is_logged_in) {
                console.warn(`[AUTH] Session Flag Check Failed for User #${decoded.user_id}. Account exists: ${!!account}, is_logged_in: ${account?.is_logged_in}`);
                return res.status(401).json({ message: 'Unauthorized! Please login again (Section conflict or signed out).' });
            }

            req.userId = decoded.user_id;
            req.userRole = decoded.role;
            next();
        } catch (dbErr) {
            return res.status(500).json({ message: 'Internal server error' });
        }
    });
};

const isAdmin = (req, res, next) => {
    if (req.userRole !== 'ADMIN' && req.userRole !== 'admin') {
        return res.status(403).json({ message: 'Require Admin Role!' });
    }
    next();
};

module.exports = {
    verifyToken,
    isAdmin
};
