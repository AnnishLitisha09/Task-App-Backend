const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, AuthAccount, RoleAssignment, Role, Student, Faculty, Staff, RoleUser, Scope, Venue } = require("../models");

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

        const token = jwt.sign(
            {
                user_id: account.User.user_id,
                role: account.User.role
            },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        let baseRole = account.User.role.charAt(0).toUpperCase() + account.User.role.slice(1);
        let specificRole = baseRole;
        let scopeDetails = 'N/A';
        let allRoles = [baseRole];

        // Aggregate all unique Roles and Scopes
        if (account.User.RoleAssignments && account.User.RoleAssignments.length > 0) {
            const mgmtRoles = account.User.RoleAssignments.map(ra => {
                let name = ra.Role?.user_role || '';
                return name.toLowerCase().includes("incharge") ? "Incharge" : name;
            }).filter(Boolean);

            const uniqueMgmtRoles = [...new Set(mgmtRoles)];
            const scopes = account.User.RoleAssignments.map(ra => ra.Role?.Scope?.scope).filter(Boolean);
            const uniqueScopes = [...new Set(scopes)];

            if (uniqueMgmtRoles.length > 0) {
                specificRole = `${baseRole} / ${uniqueMgmtRoles.join(', ')}`;
                allRoles = [...new Set([baseRole, ...uniqueMgmtRoles])];
            }
            if (uniqueScopes.length > 0) {
                scopeDetails = uniqueScopes.join(', ');
            }
        }

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

        // Generate JWT
        const jwtToken = jwt.sign(
            { user_id: account.User.user_id, role: account.User.role },
            JWT_SECRET,
            { expiresIn: "1d" }
        );

        let baseRole = account.User.role.charAt(0).toUpperCase() + account.User.role.slice(1);
        let specificRole = baseRole;
        let scopeDetails = 'N/A';
        let allRoles = [baseRole];

        // Aggregate all unique Roles and Scopes
        if (account.User.RoleAssignments && account.User.RoleAssignments.length > 0) {
            const mgmtRoles = account.User.RoleAssignments.map(ra => {
                let name = ra.Role?.user_role || '';
                return name.toLowerCase().includes("incharge") ? "Incharge" : name;
            }).filter(Boolean);

            const uniqueMgmtRoles = [...new Set(mgmtRoles)];
            const scopes = account.User.RoleAssignments.map(ra => ra.Role?.Scope?.scope).filter(Boolean);
            const uniqueScopes = [...new Set(scopes)];

            if (uniqueMgmtRoles.length > 0) {
                specificRole = `${baseRole} / ${uniqueMgmtRoles.join(', ')}`;
                allRoles = [...new Set([baseRole, ...uniqueMgmtRoles])];
            }
            if (uniqueScopes.length > 0) {
                scopeDetails = uniqueScopes.join(', ');
            }
        }

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
                        { model: Venue, attributes: ['venue_id', 'name', 'location'] },
                        { model: Department, attributes: ['name'] }
                    ]
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const dashboards = [];

        // 1. Basic role-based dashboards with details
        if (user.Student) {
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

        if (user.Faculty) {
            dashboards.push({
                type: 'faculty',
                label: 'Faculty Dashboard',
                details: {
                    name: user.Faculty.name,
                    role: user.Faculty.type || 'Faculty',
                    reg_no: user.Faculty.reg_no,
                    department: user.Faculty.Department?.name || 'N/A'
                }
            });
        }

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

        // 2. Assignment-based dashboards (Incharge, HOD, etc.)
        const assignments = user.RoleAssignments || [];

        // Check for Incharge status (venue assignment)
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

        // Check for HOD status
        const hodAssignment = assignments.find(ra => ra.Role?.user_role === 'HOD' && ra.Department);
        if (hodAssignment) {
            dashboards.push({
                type: 'hod',
                label: 'HOD Dashboard',
                details: {
                    department: hodAssignment.Department.name,
                    role: 'HOD'
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
