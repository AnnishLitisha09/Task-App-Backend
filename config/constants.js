/**
 * Global Conflict Management Constants
 */
module.exports = {
    // Priority weights for numeric comparison
    PRIORITY_WEIGHTS: {
        'low': 1,
        'medium': 2,
        'high': 3,
        'critical': 4
    },

    // Time Constraints
    BUFFER_MINUTES: 5,
    MAX_DAILY_TASKS: 8,
    
    // Work Hours (Local Time)
    WORK_START: '08:45',
    WORK_END: '16:30',

    // Task Security
    LOCK_WINDOW_MINUTES: 30,

    // Escalation Rules
    ESCALATION_WINDOW_START: '19:00', // 7:00 PM
    ESCALATION_WINDOW_END: '08:45'    // 8:45 AM
};
