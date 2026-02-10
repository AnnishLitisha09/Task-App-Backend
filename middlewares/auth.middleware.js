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

    jwt.verify(tokenValue, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Unauthorized!' });
        }
        req.userId = decoded.user_id;
        req.userRole = decoded.role;
        next();
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
