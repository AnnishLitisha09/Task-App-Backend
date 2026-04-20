const { User, Student, Faculty, Staff, RoleAssignment, Role } = require('../models');

/**
 * getSupervisor
 * Returns the user_id of the person who should receive escalations for this user.
 * 
 * Hierarchy:
 * - Student -> Mentor Faculty
 * - Staff -> Manager
 * - Faculty -> HOD of Department
 * - HOD -> Principal
 * - Other Role Users -> HOD/Principal (fallback)
 */
const getSupervisor = async (userId, cache = null) => {
    if (cache && cache[userId]) return cache[userId];

    const findLogic = async () => {
        try {
            const user = await User.findByPk(userId);
            if (!user) return null;

            const role = user.role.toLowerCase();

            if (role === 'student') {
                const student = await Student.findOne({ where: { user_id: userId } });
                if (student && student.faculty_id) {
                    const fac = await Faculty.findByPk(student.faculty_id);
                    return fac?.user_id || null;
                }
            } else if (role === 'staff') {
                const staff = await Staff.findOne({ where: { user_id: userId } });
                return staff?.manager_id || null;
            } else if (role === 'faculty') {
                const fac = await Faculty.findOne({ where: { user_id: userId } });
                if (fac) {
                    // Find HOD of the same department
                    const hodAssignment = await RoleAssignment.findOne({
                        where: { department_id: fac.department_id },
                        include: [{
                            model: Role,
                            where: { user_role: 'HOD' }
                        }]
                    });
                    return hodAssignment?.user_id || null;
                }
            } else if (role === 'role-user') {
                // Check if user has HOD role
                const myRoles = await RoleAssignment.findAll({
                    where: { user_id: userId },
                    include: [{ model: Role }]
                });
                const roleNames = myRoles.map(r => r.Role?.user_role?.toUpperCase() || '');

                if (roleNames.includes('HOD')) {
                    // HOD escalates to Principal
                    const principalAssignment = await RoleAssignment.findOne({
                        include: [{
                            model: Role,
                            where: { user_role: 'Principal' }
                        }]
                    });
                    return principalAssignment?.user_id || null;
                } else if (roleNames.includes('INCHARGE')) {
                    // Incharge likely escalates to HOD
                    const myDeptAssignment = myRoles.find(r => r.department_id);
                    if (myDeptAssignment) {
                        const hodAssignment = await RoleAssignment.findOne({
                            where: { department_id: myDeptAssignment.department_id },
                            include: [{
                                model: Role,
                                where: { user_role: 'HOD' }
                            }]
                        });
                        return hodAssignment?.user_id || null;
                    }
                }
            }

            // Default Fallback: If no specific supervisor, escalate to Principal
            const fallbackPrincipal = await RoleAssignment.findOne({
                include: [{
                    model: Role,
                    where: { user_role: 'Principal' }
                }]
            });
            return fallbackPrincipal?.user_id || null;
        } catch (error) {
            console.error('Error in getSupervisor findLogic:', error);
            return null;
        }
    };

    const result = await findLogic();
    if (cache) cache[userId] = result;
    return result;
};

module.exports = { getSupervisor };
