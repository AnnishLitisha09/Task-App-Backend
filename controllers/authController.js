const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, AuthAccount, RoleAssignment, Role, Student, Faculty, Staff, RoleUser, Scope, Venue, Department } = require("../models");

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
            include: [
                {
                    model: User,
                    attributes: ["user_id", "role", "status"],
                    include: [{
                        model: RoleAssignment,
                        include: [{
                            model: Role,
                            attributes: ["user_role"],
                            include: [{ model: Scope, attributes: ["scope"] }]
                        }]
                    }]
                },
                { model: Student, attributes: ["name"], required: false },
                { model: Faculty, attributes: ["name"], required: false },
                { model: Staff, attributes: ["name"], required: false },
                { model: RoleUser, attributes: ["name"], required: false }
            ]
        });

        if (!account || !account.User) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const ok = await bcrypt.compare(password, account.hashed_password);
        if (!ok) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        // --- NEW: Single-Device Login Check ---
        if (account.is_logged_in && account.User.role !== "ADMIN" && account.User.role !== "admin") {
            return res.status(409).json({ 
                message: "Session already active on another device. Please logout from your previous device or contact administrator to revoke your session.",
                error_code: "ALREADY_LOGGED_IN"
            });
        }

        // Set is_logged_in flag
        await account.update({ is_logged_in: true });

        const token = jwt.sign(
            {
                user_id: account.User.user_id,
                role: account.User.role
            },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        // 1. Determine profile-based role
        let profileRole = null;
        if (account.Faculty) profileRole = "Faculty";
        else if (account.Staff) profileRole = "Staff";
        else if (account.Student) profileRole = "Student";

        // 2. Determine management roles
        let mgmtRoles = [];
        if (account.User.RoleAssignments && account.User.RoleAssignments.length > 0) {
            mgmtRoles = account.User.RoleAssignments.map(ra => {
                let name = ra.Role?.user_role || '';
                // Map 'role-user' or anything including 'incharge' to 'Incharge'
                if (name.toLowerCase() === 'role-user' || name.toLowerCase().includes("incharge")) {
                    return "Incharge";
                }
                return name;
            }).filter(Boolean);
        }
        const uniqueMgmtRoles = [...new Set(mgmtRoles)];

        // 3. Consolidate Roles (Priority to Profile and Management roles)
        let allRoles = [...new Set([profileRole, ...uniqueMgmtRoles])].filter(r => 
            r && r.toLowerCase() !== 'role-user' && r.toLowerCase() !== 'user'
        );

        // 4. Fallback logic if still empty
        if (allRoles.length === 0) {
            const base = account.User.role.charAt(0).toUpperCase() + account.User.role.slice(1);
            if (base.toLowerCase() !== 'role-user' && base.toLowerCase() !== 'user') {
                allRoles = [base];
            } else {
                allRoles = ["User"]; // Absolute fallback if nothing else found
            }
        }

        const specificRole = uniqueMgmtRoles.length > 0 ? uniqueMgmtRoles.join(', ') : allRoles[0];
        const scopeDetails = account.User.RoleAssignments?.[0]?.Role?.Scope?.scope || 'N/A';

        const userName = account.Student?.name || account.Faculty?.name || account.Staff?.name || account.RoleUser?.name || "User";

        // NEW: Get venues where the user is an incharge
        const inchargeVenues = await RoleAssignment.findAll({
            where: { user_id: account.User.user_id },
            include: [{ model: Venue, attributes: ['venue_id', 'name', 'location'] }],
            attributes: ['venue_id']
        });

        const venues = inchargeVenues
            .filter(ra => ra.Venue)
            .map(ra => ({
                venue_id: ra.Venue.venue_id,
                name: ra.Venue.name,
                location: ra.Venue.location
            }));

        res.json({
            token,
            user_id: account.User.user_id,
            user_name: userName,
            role: account.User.role,
            specific_role: specificRole,
            all_roles: allRoles,
            scope_details: scopeDetails,
            incharge_venues: venues
        });

    } catch (err) {
        console.error("LOGIN ERROR 👉", err);
        res.status(500).json({ message: err.message });
    }
};

exports.googleLogin = async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ message: "Token is required" });

        // Verify Google ID token
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const { email } = ticket.getPayload();

        // Find account created by admin (removed deleted_at)
        const account = await AuthAccount.findOne({
            where: { email },
            include: [
                {
                    model: User,
                    attributes: ["user_id", "role", "status"],
                    include: [{
                        model: RoleAssignment,
                        include: [{
                            model: Role,
                            attributes: ["user_role"],
                            include: [{ model: Scope, attributes: ["scope"] }]
                        }]
                    }]
                },
                { model: Student, attributes: ["name"], required: false },
                { model: Faculty, attributes: ["name"], required: false },
                { model: Staff, attributes: ["name"], required: false },
                { model: RoleUser, attributes: ["name"], required: false }
            ]
        });

        if (!account || !account.User) {
            return res.status(403).json({ message: "Account not created by admin" });
        }

        // --- NEW: Single-Device Login Check ---
        if (account.is_logged_in && account.User.role !== "ADMIN" && account.User.role !== "admin") {
            return res.status(409).json({ 
                message: "Session already active on another device. Please logout from your previous device or contact administrator to revoke your session.",
                error_code: "ALREADY_LOGGED_IN"
            });
        }

        // Set is_logged_in flag
        await account.update({ is_logged_in: true });

        // Generate JWT
        const jwtToken = jwt.sign(
            { user_id: account.User.user_id, role: account.User.role },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        // 1. Determine profile-based role
        let profileRole = null;
        if (account.Faculty) profileRole = "Faculty";
        else if (account.Staff) profileRole = "Staff";
        else if (account.Student) profileRole = "Student";

        // 2. Determine management roles
        let mgmtRoles = [];
        if (account.User.RoleAssignments && account.User.RoleAssignments.length > 0) {
            mgmtRoles = account.User.RoleAssignments.map(ra => {
                let name = ra.Role?.user_role || '';
                // Map 'role-user' or anything including 'incharge' to 'Incharge'
                if (name.toLowerCase() === 'role-user' || name.toLowerCase().includes("incharge")) {
                    return "Incharge";
                }
                return name;
            }).filter(Boolean);
        }
        const uniqueMgmtRoles = [...new Set(mgmtRoles)];

        // 3. Consolidate Roles (Priority to Profile and Management roles)
        let allRoles = [...new Set([profileRole, ...uniqueMgmtRoles])].filter(r => 
            r && r.toLowerCase() !== 'role-user' && r.toLowerCase() !== 'user'
        );

        // 4. Fallback logic if still empty
        if (allRoles.length === 0) {
            const base = account.User.role.charAt(0).toUpperCase() + account.User.role.slice(1);
            if (base.toLowerCase() !== 'role-user' && base.toLowerCase() !== 'user') {
                allRoles = [base];
            } else {
                allRoles = ["User"]; // Absolute fallback if nothing else found
            }
        }

        const specificRole = uniqueMgmtRoles.length > 0 ? uniqueMgmtRoles.join(', ') : allRoles[0];
        const scopeDetails = account.User.RoleAssignments?.[0]?.Role?.Scope?.scope || 'N/A';

        const userName = account.Student?.name || account.Faculty?.name || account.Staff?.name || account.RoleUser?.name || "User";

        // NEW: Get venues where the user is an incharge
        const inchargeVenues = await RoleAssignment.findAll({
            where: { user_id: account.User.user_id },
            include: [{ model: Venue, attributes: ['venue_id', 'name', 'location'] }],
            attributes: ['venue_id']
        });

        const venues = inchargeVenues
            .filter(ra => ra.Venue)
            .map(ra => ({
                venue_id: ra.Venue.venue_id,
                name: ra.Venue.name,
                location: ra.Venue.location
            }));

        res.json({
            token: jwtToken,
            user_id: account.User.user_id,
            user_name: userName,
            role: account.User.role,
            specific_role: specificRole,
            all_roles: allRoles,
            scope_details: scopeDetails,
            incharge_venues: venues
        });
    } catch (err) {
        console.error("GOOGLE LOGIN ERROR 👉", err);
        res.status(401).json({ message: "Invalid Google token" });
    }
};
exports.getUserContext = async (req, res) => {
    try {
        const user_id = req.userId;

        const user = await User.findByPk(user_id, {
            include: [
                {
                    model: Student,
                    required: false,
                    include: [{ model: Department, attributes: ["name"] }]
                },
                {
                    model: Faculty,
                    required: false,
                    include: [{ model: Department, attributes: ["name"] }]
                },
                {
                    model: Staff,
                    required: false,
                    include: [{ model: Department, attributes: ["name"] }]
                },
                { model: RoleUser, required: false },
                {
                    model: RoleAssignment,
                    required: false,
                    include: [
                        { model: Role, attributes: ['user_role'] },
                        { model: Venue, as: 'Venue', attributes: ['venue_id', 'name', 'location'] },
                        { model: Department, attributes: ['name'] }
                    ]
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const dashboards = [];

        // 1. Unified Management/Higher Role Dashboard (Faculty & HOD)
        const hodAssignment = (user.RoleAssignments || []).find(ra => ra.Role?.user_role === 'HOD' && ra.Department);
        
        if (user.Faculty || hodAssignment) {
            dashboards.push({
                type: 'faculty', // Unified type for higher roles
                label: hodAssignment ? 'HOD Dashboard' : 'Faculty Dashboard',
                details: {
                    name: user.Faculty?.name || user.Student?.name || 'Administrator',
                    role: hodAssignment ? 'HOD' : (user.Faculty?.type || 'Faculty'),
                    reg_no: user.Faculty?.reg_no || '',
                    department: hodAssignment?.Department?.name || user.Faculty?.Department?.name || 'N/A'
                }
            });
        }

        // 2. Student Dashboard
        if (user.Student && !hodAssignment && !user.Faculty) {
            dashboards.push({
                type: 'student',
                label: 'Student Dashboard',
                details: {
                    name: user.Student.name,
                    role: 'Student',
                    reg_no: user.Student.reg_no,
                    department: user.Student.Department?.name || 'N/A'
                }
            });
        }

        // 3. Staff Dashboard
        if (user.Staff) {
            dashboards.push({
                type: 'staff',
                label: 'Staff Dashboard',
                details: {
                    name: user.Staff.name,
                    role: user.Staff.type || 'Staff',
                    department: user.Staff.Department?.name || 'N/A'
                }
            });
        }

        // 4. Admin Dashboard
        if (user.role === 'admin') {
            dashboards.push({
                type: 'admin',
                label: 'Admin Dashboard',
                details: {
                    name: 'Administrator',
                    role: 'Admin'
                }
            });
        }

        // 5. Assignment-based dashboards (Venue Incharge) - This remains "swappable"
        const assignments = user.RoleAssignments || [];
        const inchargeVenues = assignments.filter(ra => ra.Venue).map(ra => ({
            venue_id: ra.Venue.venue_id,
            name: ra.Venue.name,
            location: ra.Venue.location
        }));

        if (inchargeVenues.length > 0) {
            dashboards.push({
                type: 'incharge',
                label: 'Venue Incharge Dashboard',
                details: {
                    venues: inchargeVenues
                }
            });
        }

        res.json({
            user_id: user.user_id,
            role: user.role,
            dashboards
        });

    } catch (err) {
        console.error("GET USER CONTEXT ERROR 👉", err);
        res.status(500).json({ message: err.message });
    }
};
exports.logout = async (req, res) => {
    try {
        const userId = req.userId;
        const account = await AuthAccount.findByPk(userId);

        if (account) {
            await account.update({ is_logged_in: false });
        }

        res.json({ success: true, message: "Logged out successfully" });
    } catch (err) {
        console.error("LOGOUT ERROR 👉", err);
        res.status(500).json({ message: err.message });
    }
};

exports.adminLogoutUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const account = await AuthAccount.findByPk(userId);

        if (!account) {
            return res.status(404).json({ message: "User account not found" });
        }

        await account.update({ is_logged_in: false });

        res.json({ 
            success: true, 
            message: `User #${userId} has been logged out by administrator` 
        });
    } catch (err) {
        console.error("ADMIN LOGOUT ERROR 👉", err);
        res.status(500).json({ message: err.message });
    }
};
exports.getActiveSessions = async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const activeAccounts = await AuthAccount.findAll({
            where: { is_logged_in: true },
            include: [
                {
                    model: User,
                    attributes: ["role", "status"],
                    where: { role: { [Op.notIn]: ['ADMIN', 'admin'] } }
                },
                { model: Student, attributes: ["name"], required: false },
                { model: Faculty, attributes: ["name"], required: false },
                { model: Staff, attributes: ["name"], required: false },
                { model: RoleUser, attributes: ["name"], required: false }
            ]
        });

        const sessions = activeAccounts.map(acc => ({
            user_id: acc.user_id,
            email: acc.email,
            role: acc.User?.role || 'N/A',
            name: acc.Student?.name || acc.Faculty?.name || acc.Staff?.name || acc.RoleUser?.name || "Unknown User"
        }));

        res.json(sessions);
    } catch (err) {
        console.error("GET ACTIVE SESSIONS ERROR 👉", err);
        res.status(500).json({ message: err.message });
    }
};
