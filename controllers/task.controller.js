const { Task, TaskAssign, TaskType, TaskPackageClosure, TaskClosure, User, Student, Faculty, Staff, RoleUser, RoleAssignment, Role, Department, TaskEscalation, AuthAccount, Notification, TaskLog, TaskTitle, Venue, TaskApprovalRequest } = require('../models');
const { Op } = require('sequelize');

function calculateEndWorkingDateTime(startDate, startTime, durationHours) {
    if (!startDate || !startTime || !durationHours) return null;
    
    let [h, m, s] = startTime.split(':').map(Number);
    let current = new Date(startDate);
    current.setHours(h, m, s || 0);

    const workStartMinutes = 8 * 60 + 45; // 08:45
    const workEndMinutes = 16 * 60 + 30;  // 16:30
    const dailyWorkMinutes = workEndMinutes - workStartMinutes;

    let remainingMinutes = parseFloat(durationHours) * 60;

    // 1. Initial Adjustment: If start time is before working hours, move to start of work
    let currentTotalMinutes = current.getHours() * 60 + current.getMinutes();
    if (currentTotalMinutes < workStartMinutes) {
        current.setHours(8, 45, 0);
        currentTotalMinutes = workStartMinutes;
    } else if (currentTotalMinutes >= workEndMinutes) {
        // Move to next day
        current.setDate(current.getDate() + 1);
        current.setHours(8, 45, 0);
        currentTotalMinutes = workStartMinutes;
    }

    // 2. Walk forward
    while (remainingMinutes > 0) {
        // Skip Sundays
        if (current.getDay() === 0) {
            current.setDate(current.getDate() + 1);
            current.setHours(8, 45, 0);
            currentTotalMinutes = workStartMinutes;
            continue;
        }

        let minutesAvailableToday = workEndMinutes - currentTotalMinutes;
        
        if (remainingMinutes <= minutesAvailableToday) {
            // Fits in today
            current.setMinutes(current.getMinutes() + remainingMinutes);
            remainingMinutes = 0;
        } else {
            // Use up today and move to next day
            remainingMinutes -= minutesAvailableToday;
            current.setDate(current.getDate() + 1);
            current.setHours(8, 45, 0);
            currentTotalMinutes = workStartMinutes;
        }
    }

    const end_date = current.toISOString().split('T')[0];
    const end_time = current.toTimeString().split(' ')[0];
    
    return { end_date, end_time };
}

function calculateEndDateTime(startDate, startTime, durationHours) {
    if (!startDate || !startTime || !durationHours) return null;
    const [h, m, s] = startTime.split(':').map(Number);
    const date = new Date(startDate);
    date.setHours(h, m, s || 0);
    
    // Use UTC for relative calculation then format back
    const endDateTime = new Date(date.getTime() + durationHours * 60 * 60 * 1000);
    
    // Format YYYY-MM-DD
    const end_date = endDateTime.toISOString().split('T')[0];
    
    // Format HH:mm:ss
    const end_time = endDateTime.toTimeString().split(' ')[0];
    
    return { end_date, end_time };
}
const XLSX = require('xlsx');
const os = require('os');
const { canAssignTo } = require('./task.assignment');
const { checkTaskOverlap, isWithinWorkHours, getWorkingMinutes, toISTDateStr, isOccurrence, adjustLongTaskStatus, createNotification, resolveTaskEscalations } = require('../utils/task-utils');
const { MAX_DAILY_TASKS, PRIORITY_WEIGHTS } = require('../config/constants');


// Helper: Pagination
const getPagination = (query) => {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    return { limit, offset, page };
};

const getPagingData = (data, page, limit) => {
    const { count: totalItems, rows: items } = data;
    const currentPage = page ? +page : 1;
    const totalPages = Math.ceil(totalItems / limit);
    return { totalItems, items, totalPages, currentPage };
};


// Helper: Get Network IP for cross-device visibility
const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
};

// Helper: Check if user can create tasks
const canCreateTask = (userRole) => {
    return ['admin', 'role-user', 'faculty', 'student', 'staff'].includes(userRole?.toLowerCase());
};

/**
 * Helper: Determine the primary UI action button for a task based on user context.
 * Returns { type: string, label: string, action: string } or null.
 *
 * Priority Order:
 *  1. Designated approver (approve_task)
 *  2. Pending assignment acceptance (request)
 *  3. Escalated directive (escalated)
 *  4. Proof verification by manager/creator (verify_proof)
 *  5. OTP generation for creator/faculty
 *  6. Assignee lifecycle: accepted → in_progress → completed
 *     - in_progress + is_pause_allowed (long task): pause/resume + end (frontend shows 2 buttons)
 *     - in_progress + !is_pause_allowed + is_document: submit_proof (single button)
 *     - in_progress + !is_pause_allowed: end (single button)
 *     - accepted + is_document (student): submit proof waiting
 *     - accepted: start activity (with timing checks)
 *  7. Manager/creator (no assignment): manage task
 */
const getTaskButtonState = (task, userId, userRole) => {
    try {
        const now = new Date();
        const uId = userId ? String(userId) : null;
        const uRole = userRole?.toLowerCase() || '';
        const stage = task.stage;

        // Ensure associations exist
        const assignments = task.TaskAssigns || [];
        const taskTypes = task.TaskTypes || [];
        const escalations = task.TaskEscalations || [];
        const taskType = taskTypes[0];

        // Find the current user's assignment
        const assignment = assignments.find(a => String(a.user_id) === uId);

        // ── 0. Permissions ──────────────────────────────────────────────────
        const isManager = ['admin', 'role-user', 'faculty', 'hod', 'principal', 'dean', 'incharge', 'registrar', 'director', 'staff'].includes(uRole);
        const isCreator = String(task.creator_id) === uId;
        const isAssignedFaculty = task.is_faculty && String(task.faculty_id) === uId;
        const isAuthority = isManager || isCreator || isAssignedFaculty;

        // ── 1. Global / Termination States ──────────────────────────────────
        if (['completed', 'cancelled', 'closed', 'Inactive'].includes(task.status)) {
            if (!isAuthority) {
                if (assignment && ['completed', 'closed'].includes(assignment.status?.toLowerCase())) {
                    return { type: 'activity', label: 'Completed', action: 'completed' };
                }
                return null;
            }
            // Authorities bypass this to management section
        }

        // ── 2. STAGE-DRIVEN LOGIC HIGH PRIORITY ──────────────────────────────
        
        // 2a. Authority Approval (Designated Approver)
        if (stage === 'approval' || (task.approver_id && String(task.approver_id) === uId && !task.is_approved)) {
            return { type: 'approve_task', label: 'Approve Task', action: 'approve' };
        }

        // 2b. Executive Directive (Escalated)
        const hasRejections = assignments.some(a => a.status?.toLowerCase() === 'rejected');
        if (stage === 'escalated' || task.is_escalate || hasRejections) {
            if (isAuthority && (!assignment || ['pending', 'rejected'].includes(assignment.status?.toLowerCase()))) {
                return { type: 'escalated', label: 'Execute Directive', action: 'execute' };
            }
        }

        // 2c. Manager Verification (Review Submissions)
        if (stage === 'verification' || (assignments.some(a => ['completed', 'Review'].includes(a.status)) && isAuthority)) {
            // Check if there are actual proofs to verify
            const hasProofs = assignments.some(a => (a.status === 'completed' || a.status === 'Review') && a.proof);
            if (hasProofs) {
                return { type: 'verify_proof', label: 'Review Submissions', action: 'verify' };
            }
        }

        // ── 3. ASSIGNEE LIFECYCLE (Driven by Stage + Assignment Status) ──────
        if (assignment) {
            const status = assignment.status?.toLowerCase();

            // 3a. Acceptance Stage
            if (status === 'pending' || status === 'review' || stage === 'acceptance') {
                return { type: 'request', label: 'Accept / Reject', action: 'acceptance' };
            }

            // 3b. Activity Start Stage
            if (status === 'accepted' || stage === 'activity_start') {
                // Timing logic still applies for "Start"
                if (taskType) {
                    const startDate = taskType.start_date ? new Date(taskType.start_date) : null;
                    const startTime = taskType.start_time || '00:00:00';
                    const endDate = taskType.end_date ? new Date(taskType.end_date) : null;
                    const endTime = taskType.end_time || '23:59:59';

                    let startDT = null;
                    if (startDate) {
                        const dateStr = startDate.toISOString().split('T')[0];
                        startDT = new Date(`${dateStr}T${startTime}`);
                    }

                    let endDT = null;
                    if (endDate) {
                        const dateStr = endDate.toISOString().split('T')[0];
                        endDT = new Date(`${dateStr}T${endTime}`);
                    }

                    if (startDT && now < startDT) {
                        return { type: 'activity', label: 'Starts Soon / Yet to Come', action: 'too_early' };
                    }
                    if (endDT && now > endDT) {
                        return { type: 'activity', label: 'Activity Missed', action: 'missed' };
                    }
                }
                
                if (uRole === 'student') {
                    return { type: 'activity', label: 'Start OTP', action: 'start_otp' };
                }
                return { type: 'activity', label: 'Start Activity', action: 'start' };
            }

            // 3c. In Progress Lifecycle (End / Pause / Resume)
            if (['in_progress', 'started', 'ongoing'].includes(status) || ['pauses', 'resume', 'activity_end'].includes(stage)) {
                
                // Pause/Resume Logic: Always allowed for Long Tasks
                const isLongTask = taskType && taskType.task_name === 'Date-Only / Long Task';
                if (task.is_pause_allowed || stage === 'pauses' || stage === 'resume' || isLongTask) {
                    if (assignment.is_paused || stage === 'pauses') {
                        return { type: 'activity', label: 'Resume', action: 'resume' };
                    }
                    // Only show Pause if not explicitly in resume sub-stage
                    if (stage !== 'resume') {
                        return { type: 'activity', label: 'Pause', action: 'pause' };
                    }
                }

                // End Activity Logic (with 10 min window for fixed tasks, immediate for long tasks)
                if (taskType) {
                    const endDate = taskType.end_date ? new Date(taskType.end_date) : new Date();
                    const dateStr = endDate.toISOString().split('T')[0];
                    const endTime = taskType.end_time || '23:59:59';
                    const endDateTime = new Date(`${dateStr}T${endTime}`);
                    const threshold = new Date(endDateTime.getTime() - 10 * 60 * 1000);
                    
                    // Students wait until last 10 mins UNLESS it is a Long Task
                    if (now < threshold && uRole === 'student' && !isLongTask) {
                        return null; 
                    }
                }

                const requiresOtp = uRole === 'student';
                if (requiresOtp) {
                    return { type: 'activity', label: task.is_document ? 'Submit Proof & End OTP' : 'End OTP', action: 'end_otp' };
                }
                if (task.is_document && !isCreator) {
                    return { type: 'activity', label: 'Submit Proof & End', action: 'submit_proof' };
                }
                return { type: 'activity', label: 'End Activity', action: 'end' };
            }
        }

        // ── 4. Fallback: Management (No Assignment) ──────────────────────────
        if (isAuthority) {
            let isExpired = false;
            if (taskType && taskType.end_date) {
                const dateStr = new Date(taskType.end_date).toISOString().split('T')[0];
                const endDateTime = new Date(`${dateStr}T${taskType.end_time || '23:59:59'}`);
                isExpired = now > endDateTime;
            }

            // If task requires OTP, show Generate OTP for the supervisor/manager
            const requiresOtp = task.is_otp_required || (task.closure_ids && (task.closure_ids.includes(1) || task.closure_ids.includes("1")));
            if (requiresOtp && !isExpired) {
                return { type: 'generate_otp', label: 'Generate OTP', action: 'generate_otp' };
            }

            return { type: 'manage', label: 'Manage Task', action: isExpired ? 'reschedule' : 'self_assign' };
        }

        return null;
    } catch (e) {
        console.error("Button Logic Error:", e);
        return null;
    }
};

const validateTaskType = (taskTypeData, priority = 'low') => {
    const { task_name, start_date, end_date, start_time, end_time, recurrence, time_quota_hours, venue_id } = taskTypeData;

    // Check Business Hours (Rule 6)
    if (['Fixed Time Task', 'Floating Task', 'Recurring Task', 'Meeting'].includes(task_name)) {
        if (start_time && end_time) {
            const check = isWithinWorkHours(start_time, end_time, priority);
            if (!check.isWithin) {
                throw new Error(check.reason);
            }
        }
    }

    switch (task_name) {
        case 'Fixed Time Task':
            if (!start_time || !end_time) {
                throw new Error('Fixed Time Task requires start_time and end_time');
            }
            break;
        case 'Date-Only / Long Task':
        case 'Long Task':
        case 'Package Task':
            if (!start_date || !end_date) {
                throw new Error('Long Task/Package Task requires start_date and end_date');
            }
            break;
        case 'Floating Task':
            if (!start_date || !end_date || !start_time || !end_time) {
                throw new Error('Floating Task requires start_date, end_date, start_time, and end_time');
            }
            break;
        case 'Subscription Task':
            if (!time_quota_hours || !venue_id) {
                throw new Error('Subscription Task requires time_quota_hours and venue_id');
            }
            break;
        case 'Recurring Task':
            if (!recurrence || recurrence === 'none') {
                throw new Error('Recurring Task requires recurrence pattern (daily, weekly, monthly)');
            }
            if (!start_date || !end_date) {
                throw new Error('Recurring Task requires both start_date and end_date for expansion');
            }
            // Allow missing start/end time if it's meant to be auto-calculated via duration
            if (!start_time && !time_quota_hours) {
                throw new Error('Recurring Task requires start_time or duration');
            }
            break;
        case 'Meeting':
            if (!start_time || !end_time || !venue_id) {
                throw new Error('Meeting requires start_time, end_time, and venue_id');
            }
            break;
        case 'Bidding / Nomination Task':
            if (!taskTypeData.max_acceptances || parseInt(taskTypeData.max_acceptances) <= 0) {
                throw new Error('Bidding Task requires a valid max_acceptances count');
            }
            break;
        case 'Self Log':
            if (!start_date) {
                throw new Error('Self Log requires start_date');
            }
            break;
        default:
            throw new Error(`Unknown task type: ${task_name}`);
    }
};

// Helper: Normalize Task Payload (Parse JSON strings, consolidate IDs, etc.)
const normalizeTaskPayload = async (body) => {
    let payload = { ...body };

    try {
        if (typeof payload.task_type_data === 'string') payload.task_type_data = JSON.parse(payload.task_type_data);
        if (typeof payload.assignee_ids === 'string') {
            try { payload.assignee_ids = JSON.parse(payload.assignee_ids); } catch (e) { payload.assignee_ids = [payload.assignee_ids]; }
        }
        if (typeof payload.assign_to_groups === 'string') payload.assign_to_groups = JSON.parse(payload.assign_to_groups);
        if (typeof payload.closure_ids === 'string') payload.closure_ids = JSON.parse(payload.closure_ids);
        if (typeof payload.sub_tasks === 'string') payload.sub_tasks = JSON.parse(payload.sub_tasks);
        if (typeof payload.faculty_ids === 'string') {
            try { payload.faculty_ids = JSON.parse(payload.faculty_ids); } catch (e) { payload.faculty_ids = [payload.faculty_ids]; }
        }
    } catch (e) {
        console.error('Payload Normalization Parsing error:', e);
    }

    // Consolidate assignee_id and assignee_ids
    let finalIds = [];
    if (payload.assignee_id) finalIds.push(parseInt(payload.assignee_id));
    if (payload.assignee_ids) {
        const ids = Array.isArray(payload.assignee_ids) ? payload.assignee_ids : [payload.assignee_ids];
        ids.forEach(id => {
            const numericId = parseInt(id);
            if (!isNaN(numericId) && !finalIds.includes(numericId)) finalIds.push(numericId);
        });
    }
    payload.assignee_ids = finalIds;

    // Faculty specific normalization & PK Resolution
    if (payload.faculty_ids && Array.isArray(payload.faculty_ids) && payload.faculty_ids.length > 0) {
        if (!payload.faculty_id) payload.faculty_id = payload.faculty_ids[0];
    }
    if (payload.facultyId && !payload.faculty_id) payload.faculty_id = payload.facultyId;
    if (payload.isFaculty !== undefined && payload.is_faculty === undefined) payload.is_faculty = payload.isFaculty;

    if (payload.faculty_id) {
        let facultyRecord = await Faculty.findByPk(payload.faculty_id);
        if (!facultyRecord) {
            facultyRecord = await Faculty.findOne({ where: { user_id: payload.faculty_id } });
        }
        if (facultyRecord) {
            const oldId = parseInt(payload.faculty_id);
            payload.faculty_id = facultyRecord.id; // Resolve to PK for Task table
            payload.is_faculty = true; // Auto-infer

            // Ensure correct user_id is in assignees, and remove the PK if it was mistakenly added
            if (facultyRecord.user_id) {
                const fUserId = facultyRecord.user_id * 1;

                // If the oldId was a PK and was in assignee_ids, remove it
                if (oldId === facultyRecord.id) {
                    payload.assignee_ids = payload.assignee_ids.filter(id => id !== oldId);
                }

                if (!payload.assignee_ids.includes(fUserId)) {
                    payload.assignee_ids.push(fUserId);
                }
            }
        }
    }

    // Staff specific normalization & PK Resolution
    if (payload.staffId && !payload.staff_id) payload.staff_id = payload.staffId;
    if (payload.staff_id) {
        let staffRecord = await Staff.findByPk(payload.staff_id);
        if (!staffRecord) {
            staffRecord = await Staff.findOne({ where: { user_id: payload.staff_id } });
        }
        if (staffRecord) {
            const oldId = parseInt(payload.staff_id);
            payload.staff_id = staffRecord.id; // Resolve to PK

            if (staffRecord.user_id) {
                const sUserId = staffRecord.user_id * 1;

                // Remove PK if it was in assignee_ids
                if (oldId === staffRecord.id) {
                    payload.assignee_ids = payload.assignee_ids.filter(id => id !== oldId);
                }

                if (!payload.assignee_ids.includes(sUserId)) {
                    payload.assignee_ids.push(sUserId);
                }
            }
        }
    }

    if (typeof payload.is_faculty === 'string') payload.is_faculty = (payload.is_faculty === 'true' || payload.is_faculty === '1');
    payload.is_faculty = !!payload.is_faculty;

    // Consistency: Map generic names to canonical names
    if (payload.task_type_data && ['Long Task', 'Task', 'Package Task'].includes(payload.task_type_data.task_name)) {
        payload.task_type_data.task_name = 'Date-Only / Long Task';
    }
    if (payload.task_type_data && payload.task_type_data.task_name === 'Bidding Task') {
        payload.task_type_data.task_name = 'Bidding / Nomination Task';
    }
    if (payload.task_type_data && payload.task_type_data.task_name === 'Fixed Task') {
        payload.task_type_data.task_name = 'Fixed Time Task';
    }

    if (payload.task_type_data) {
        if (payload.task_type_data.startTime && !payload.task_type_data.start_time) payload.task_type_data.start_time = payload.task_type_data.startTime;
        if (payload.task_type_data.endTime && !payload.task_type_data.end_time) payload.task_type_data.end_time = payload.task_type_data.endTime;
        if (payload.task_type_data.startDate && !payload.task_type_data.start_date) payload.task_type_data.start_date = payload.task_type_data.startDate;
        if (payload.task_type_data.endDate && !payload.task_type_data.end_date) payload.task_type_data.end_date = payload.task_type_data.endDate;
        if (payload.task_type_data.venueId && !payload.task_type_data.venue_id) payload.task_type_data.venue_id = payload.task_type_data.venueId;
        if (payload.task_type_data.timeQuotaHours && !payload.task_type_data.time_quota_hours) payload.task_type_data.time_quota_hours = payload.task_type_data.timeQuotaHours;
        if (payload.task_type_data.maxDurationHours && !payload.task_type_data.max_duration_hours) payload.task_type_data.max_duration_hours = payload.task_type_data.maxDurationHours;
        
        // Ensure values are null if they are empty strings
        if (payload.task_type_data.start_time === '') payload.task_type_data.start_time = null;
        if (payload.task_type_data.end_time === '') payload.task_type_data.end_time = null;
    }

    if (payload.sub_tasks && Array.isArray(payload.sub_tasks)) {
        payload.sub_tasks = payload.sub_tasks.map(sub => {
            if (sub.startTime && !sub.start_time) sub.start_time = sub.startTime;
            if (sub.endTime && !sub.end_time) sub.end_time = sub.endTime;
            if (sub.startDate && !sub.start_date) sub.start_date = sub.startDate;
            if (sub.endDate && !sub.end_date) sub.end_date = sub.endDate;
            if (sub.venueId && !sub.venue_id) sub.venue_id = sub.venueId;
            if (sub.maxDurationHours && !sub.max_duration_hours) sub.max_duration_hours = sub.maxDurationHours;
            return sub;
        });
    }

    // Consolidate approver_id and approverId
    if (payload.approverId && !payload.approver_id) payload.approver_id = payload.approverId;
    if (payload.approver_id) payload.approver_id = parseInt(payload.approver_id) || null;

    // Normalization of booleans
    if (typeof payload.requires_approval === 'string') payload.requires_approval = (payload.requires_approval === 'true');
    else if (payload.approver == 1 || payload.approver === '1' || payload.approver === 'true') payload.requires_approval = true;
    else payload.requires_approval = !!payload.requires_approval;
    // Override: If approver_id is explicitly set, approval is always required regardless of flag
    if (payload.approver_id) payload.requires_approval = true;

    if (typeof payload.is_approved === 'string') payload.is_approved = payload.is_approved === 'true';
    if (typeof payload.is_mandatory === 'string') payload.is_mandatory = payload.is_mandatory === 'true';
    if (typeof payload.is_package === 'string') payload.is_package = payload.is_package === 'true';
    if (typeof payload.is_document === 'string') payload.is_document = payload.is_document === 'true';
    payload.is_document = !!payload.is_document;

    // Normalization of Max Duration (Man Time)
    if (payload.max_hours && !payload.max_duration_hours) payload.max_duration_hours = payload.max_hours;
    if (payload.max_duration_hours) payload.max_duration_hours = parseFloat(payload.max_duration_hours) || null;

    return payload;
};
// Create Task
exports.createTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const userId = req.userId;
        const userRole = req.userRole;

        // Check if user can create tasks
        if (!canCreateTask(userRole)) {
            return res.status(403).json({ message: 'You do not have permission to create tasks' });
        }

        // Use normalization helper
        const payload = await normalizeTaskPayload(req.body);
        const {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            resource_id, is_faculty, faculty_id,
            task_type_data, sub_tasks, max_duration_hours
        } = payload;

        // Validate required fields
        if (!title || !category || !priority) {
            return res.status(400).json({ message: 'Title, category, and priority are required' });
        }

        if (!task_type_data || !task_type_data.task_name) {
            return res.status(400).json({ message: 'Task type data with task_name is required' });
        }

        // Validate task type specific fields
        validateTaskType(task_type_data, priority);

        // Check if task date is Sunday (for single tasks created via this endpoint)
        if (task_type_data.start_date) {
            const startDate = new Date(task_type_data.start_date);
            if (startDate.getDay() === 0) {
                await t.rollback();
                return res.status(400).json({ message: 'Sunday is a holiday. Tasks cannot be assigned on Sundays.' });
            }
        }

        // Create Task
        const isLongTaskType = ['Date-Only / Long Task', 'Long Task'].includes(task_type_data.task_name);
        const task = await Task.create({
            title,
            description,
            category,
            priority,
            is_package: is_package || false,
            venue_id: venue_id || null,
            is_pause_allowed: isLongTaskType ? true : (is_pause_allowed || false), // Long Tasks always allow pause
            score: score || 0,
            penalty_per_hour: penalty_per_hour || 0,
            is_document: is_document || false,
            is_mandatory: is_mandatory || false,
            resource_id: resource_id || null,
            is_faculty: is_faculty || false,
            faculty_id: faculty_id || null,
            creator_id: userId,
            is_approved: true,
            status: 'Active',
            stage: 'Active'
        }, { transaction: t });

        // Auto-calculate end date/time if duration provided
        let finalEndDate = task_type_data.end_date;
        let finalEndTime = task_type_data.end_time;

        if (task_type_data.time_quota_hours && !task_type_data.end_time) {
            const calculated = calculateEndDateTime(
                task_type_data.start_date,
                task_type_data.start_time,
                task_type_data.time_quota_hours
            );
            if (calculated) {
                finalEndDate = calculated.end_date;
                finalEndTime = calculated.end_time;
            }
        }

        // Create TaskType
        await TaskType.create({
            task_id: task.task_id,
            task_name: task_type_data.task_name,
            start_date: task_type_data.start_date || null,
            end_date: finalEndDate || null,
            start_time: task_type_data.start_time || null,
            end_time: finalEndTime || null,
            time_quota_hours: task_type_data.time_quota_hours || null,
            max_duration_hours: max_duration_hours || null,
            venue_id: task_type_data.venue_id || null,
            recurrence: task_type_data.recurrence || 'none',
            max_acceptances: task_type_data.max_acceptances || null
        }, { transaction: t });

        await t.commit();

        await TaskLog.create({
            task_id: task.task_id,
            user_id: userId,
            action: 'create',
            details: `Task created: ${title}`
        });

        res.status(201).json({
            message: 'Task created successfully',
            task_id: task.task_id
        });

    } catch (error) {
        await t.rollback();
        if (error.message.includes('work hours')) {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: error.message });
    }
};

// Get all tasks
exports.getAllTasks = async (req, res) => {
    try {
        const { task_title_id } = req.query;
        const where = { is_deleted: false };
        if (task_title_id) where.task_title_id = task_title_id;

        const tasks = await Task.findAll({
            where,
            attributes: ['task_id', 'title', 'description', 'category', 'priority', 'score', 'penalty_per_hour', 'is_approved', 'created_at', 'task_title_id', 'venue_id'],
            include: [
                { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                { model: TaskType },
                { model: Venue },
                { model: Faculty, attributes: ['name', 'department_id'] },
                { model: TaskTitle, attributes: ['id', 'task_title'] }
            ],
            order: [['task_id', 'DESC']]
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get task by ID
exports.getTaskById = async (req, res) => {
    try {
        const { id } = req.params;
        const task = await Task.findOne({
            where: { task_id: id, is_deleted: false },
            include: [
                { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                { model: User, as: 'Approver', attributes: ['user_id', 'role'] },
                { model: TaskType },
                { model: Venue },
                {
                    model: TaskAssign,
                    include: [{ model: User, attributes: ['user_id', 'role'] }]
                },
                {
                    model: Task,
                    as: 'Children',
                    include: [
                        { model: TaskType },
                        {
                            model: TaskAssign,
                            include: [{ model: User, attributes: ['user_id', 'role'] }]
                        }
                    ]
                }
            ]
        });

        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        res.json({
            ...task.toJSON(),
            stage: (task.TaskAssigns?.some(a => a.status === 'rejected') && !['completed', 'cancelled', 'closed'].includes(task.status)) ? 'escalated' : task.stage,
            is_escalate: task.is_escalate || task.TaskAssigns?.some(a => a.status === 'rejected'),
            action_button: getTaskButtonState(task, req.userId, req.userRole),
            // Ensure compatibility with standard detail response expectations
            assignees: task.TaskAssigns?.map(a => ({
                user_id: a.user_id,
                status: a.status,
                name: a.User?.Student?.name || a.User?.Faculty?.name || 'User ' + a.user_id,
                role: a.User?.role
            })) || []
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get exhaustive task details (history, logs, transfers, escalations)
exports.getExhaustiveTaskDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const task = await Task.findOne({
            where: { task_id: id, is_deleted: false },
            include: [
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'year', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Faculty, attributes: ['name', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                },
                {
                    model: User,
                    as: 'Approver',
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'year', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Faculty, attributes: ['name', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                },
                { model: TaskType },
                {
                    model: Venue,
                    attributes: ['venue_id', 'name', 'location', 'venue_type'],
                    include: [{
                        model: RoleAssignment,
                        include: [
                            {
                                model: User,
                                attributes: ['user_id', 'role'],
                                include: [
                                    { model: Student, attributes: ['name'] },
                                    { model: Faculty, attributes: ['name'] },
                                    { model: Staff, attributes: ['name'] }
                                ]
                            },
                            {
                                model: Role,
                                attributes: ['user_role'],
                                where: { user_role: 'INCHARGE' }
                            }
                        ],
                        required: false
                    }]
                },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskAssign,
                    include: [{
                        model: User,
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name', 'year', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                            { model: Faculty, attributes: ['name', 'department_id'], include: [{ model: Department, attributes: ['name'] }] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }]
                },
                {
                    model: TaskLog,
                    include: [{
                        model: User,
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }],
                    required: false
                },
                {
                    model: TaskEscalation,
                    include: [
                        {
                            model: User, as: 'Creator', attributes: ['user_id', 'role'],
                            include: [{ model: Student, attributes: ['name'] }, { model: Faculty, attributes: ['name'] }, { model: Staff, attributes: ['name'] }, { model: RoleUser, attributes: ['name'] }]
                        },
                        {
                            model: User, as: 'RejectedUser', attributes: ['user_id', 'role'],
                            include: [{ model: Student, attributes: ['name'] }, { model: Faculty, attributes: ['name'] }, { model: Staff, attributes: ['name'] }, { model: RoleUser, attributes: ['name'] }]
                        }
                    ],
                    required: false
                },
                {
                    model: Task,
                    as: 'Children',
                    include: [
                        { model: TaskType },
                        {
                            model: TaskAssign,
                            include: [{
                                model: User,
                                attributes: ['user_id', 'role'],
                                include: [
                                    { model: Student, attributes: ['name'] },
                                    { model: Faculty, attributes: ['name'] },
                                    { model: Staff, attributes: ['name'] },
                                    { model: RoleUser, attributes: ['name'] }
                                ]
                            }]
                        }
                    ],
                    required: false
                }
            ],
            order: [
                [TaskLog, 'created_at', 'ASC'], // Order logs chronologically
                [TaskEscalation, 'created_at', 'DESC'] // Order escalations newest first
            ]
        });

        if (!task) return res.status(404).json({ message: 'Task not found' });

        // Fetch Approval Request if applicable
        const approvalRequest = await TaskApprovalRequest.findOne({
            where: {
                [Op.or]: [
                    { task_id: id },
                    { task_ids: { [Op.like]: `%${id}%` } }
                ]
            },
            order: [['created_at', 'DESC']]
        });

        // Helper to format User profiles with all details
        const formatUserDetailed = (user) => {
            if (!user) return null;
            const profile = user.Student || user.Faculty || user.Staff || user.RoleUser || {};
            const dept = (user.Student?.Department || user.Faculty?.Department)?.name || 'N/A';

            return {
                user_id: user.user_id,
                role: user.role,
                name: profile.name || 'Unknown',
                year: user.Student?.year || 'N/A',
                department: dept
            };
        };

        const formatUserSimple = (user) => {
            if (!user) return null;
            const profile = user.Student || user.Faculty || user.Staff || user.RoleUser || {};
            return {
                user_id: user.user_id,
                role: user.role,
                name: profile.name || 'Unknown'
            };
        };

        const assignments_list = (task.TaskAssigns || []).map(a => ({
            assignment_id: a.id,
            assignee: formatUserDetailed(a.User),
            status: a.status,
            reason: a.reason,
            proof_url: a.proof,
            accepted_at: a.accepted_at,
            rejected_at: a.rejected_at,
            submitted_time: a.submitted_time,
            assigned_at: a.created_at
        }));

        // Group assignees
        const assignee_groups = {
            students: assignments_list.filter(a => a.assignee?.role === 'student').map(a => a.assignee),
            faculty: assignments_list.filter(a => a.assignee?.role === 'faculty').map(a => a.assignee),
            staff: assignments_list.filter(a => a.assignee?.role === 'staff').map(a => a.assignee),
            others: assignments_list.filter(a => !['student', 'faculty', 'staff'].includes(a.assignee?.role)).map(a => a.assignee)
        };

        // Summary Stats
        const summary_stats = {
            assigned: assignments_list.length,
            pending: assignments_list.filter(a => a.status === 'pending').length,
            accepted: assignments_list.filter(a => a.status === 'accepted').length,
            rejected: assignments_list.filter(a => a.status === 'rejected').length,
            in_progress: assignments_list.filter(a => a.status === 'in_progress').length,
            completed: assignments_list.filter(a => a.status === 'completed').length,
            proof_approved_successfully: assignments_list.filter(a => a.status === 'completed').length,
            started_but_not_completed: assignments_list.filter(a => a.status === 'in_progress').length,
            accepted_but_not_started: assignments_list.filter(a => a.status === 'accepted').length
        };

        // Venue details including Incharge
        const venue_incharges = (task.Venue?.RoleAssignments || []).map(ra => formatUserSimple(ra.User));

        // Execution status calculation
        const now = new Date();
        const taskType = task.TaskTypes?.[0];
        let execution_status = 'unknown';

        if (task.status === 'completed') {
            execution_status = 'completed';
        } else if (taskType) {
            const startDate = taskType.start_date ? new Date(taskType.start_date) : null;
            const endDate = taskType.end_date ? new Date(taskType.end_date) : null;

            if (startDate && now < startDate) {
                execution_status = 'not_started';
            } else if (endDate && now > endDate) {
                execution_status = 'expired';
            } else {
                execution_status = 'alive';
            }
        }

        // Timeline events
        const timeline = [
            { event: 'Task Created', timestamp: task.created_at, details: `Task created by User ${task.creator_id}` }
        ];

        const accepted_count = assignments_list.filter(a => a.accepted_at).length;
        if (accepted_count > 0) {
            const firstAccepted = assignments_list.filter(a => a.accepted_at).sort((a, b) => new Date(a.accepted_at) - new Date(b.accepted_at))[0];
            timeline.push({
                event: 'Task Accepted',
                timestamp: firstAccepted.accepted_at,
                details: `${accepted_count} user(s) have accepted this task.`
            });
        }

        (task.TaskLogs || []).forEach(log => {
            if (log.action === 'self_assign') {
                timeline.push({ event: 'Self Assigned', timestamp: log.created_at, details: log.details });
            } else if (log.action === 'transfer' || log.action === 'reject_and_transfer') {
                timeline.push({ event: 'Task Transferred', timestamp: log.created_at, details: log.details });
            } else if (log.action === 'proof_submitted') {
                timeline.push({ event: 'Proof Submitted', timestamp: log.created_at, details: log.details });
            } else if (log.action === 'proof_approved' || log.action === 'close') {
                timeline.push({ event: 'Task Completed', timestamp: log.created_at, details: log.details });
            }
        });

        // Sort timeline
        timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const formattedTask = {
            task_info: {
                task_id: task.task_id,
                title: task.title,
                description: task.description,
                category: task.category,
                priority: task.priority,
                status: task.status,
                execution_status,
                is_mandatory: task.is_mandatory,
                origin_type: task.origin_type,
                score: task.score,
                penalty_per_hour: task.penalty_per_hour,
                created_at: task.created_at,
                updated_at: task.updated_at,
                is_escalate: task.is_escalate
            },
            summary_stats,
            timeline,
            is_faculty_detail: task.is_faculty ? {
                is_faculty: true,
                faculty_id: task.faculty_id
            } : { is_faculty: false },
            schedule: taskType || null,
            venue: task.Venue ? {
                venue_id: task.Venue.venue_id,
                name: task.Venue.name,
                location: task.Venue.location,
                incharges: venue_incharges
            } : null,
            approval_detail: approvalRequest ? {
                request_id: approvalRequest.id,
                status: approvalRequest.status,
                approver_id: approvalRequest.approver_id,
                reason: approvalRequest.reason,
                created_at: approvalRequest.created_at
            } : (task.is_approved ? { status: 'approved' } : { status: 'pending' }),
            closure_methods: (task.TaskPackageClosures || []).map(c => c.TaskClosure?.name).filter(Boolean),
            assignees: {
                grouped: assignee_groups,
                all: assignments_list
            },
            people: {
                creator: formatUserDetailed(task.Creator),
                approver: formatUserDetailed(task.Approver)
            },
            escalations: (task.TaskEscalations || []).map(esc => ({
                escalation_id: esc.id,
                reason: esc.reason,
                message: esc.msg,
                status: esc.status,
                escalated_to: formatUserSimple(esc.Creator),
                escalated_about: formatUserSimple(esc.RejectedUser),
                is_read: esc.is_read,
                created_at: esc.created_at
            })),
            sub_tasks: (task.Children || []).map(child => ({
                task_id: child.task_id,
                title: child.title,
                status: child.status,
                schedule: child.TaskTypes?.[0] || null,
                assignments: (child.TaskAssigns || []).map(a => ({
                    assignee: formatUserSimple(a.User),
                    status: a.status
                }))
            })),
            stage: (assignments_list.some(a => a.status === 'rejected') && !['completed', 'cancelled', 'closed'].includes(task.status)) ? 'escalated' : task.stage,
            is_escalate: task.is_escalate || assignments_list.some(a => a.status === 'rejected'),
            action_button: getTaskButtonState(task, req.userId, req.userRole)
        };

        res.json(formattedTask);
    } catch (error) {
        console.error('Error in getExhaustiveTaskDetails:', error);
        res.status(500).json({ message: error.message });
    }
};

// Get tasks created by user
exports.getTasksCreatedByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const tasks = await Task.findAll({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType },
                { model: Venue },
                { model: TaskAssign, include: [{ model: User, attributes: ['user_id', 'role'] }] }
            ],
            order: [['task_id', 'DESC']]
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get tasks assigned to user
exports.getTasksAssignedToUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { date, limit: queryLimit, offset: queryOffset, page: queryPage } = req.query;
        const { limit, offset, page } = getPagination({ limit: queryLimit, offset: queryOffset, page: queryPage });
        const { Op, literal } = require('sequelize');

        // 1. Identify roles and venues managed by this user
        const roleAssignments = await RoleAssignment.findAll({
            where: { user_id: userId },
            include: [{ model: Role, attributes: ['user_role'] }]
        });

        const managedVenueIds = roleAssignments
            .filter(ra => ra.venue_id && ra.Role?.user_role?.toLowerCase().includes('incharge'))
            .map(ra => ra.venue_id);

        const managedDeptIds = roleAssignments
            .filter(ra => ra.department_id && ra.Role?.user_role?.toLowerCase() === 'hod')
            .map(ra => ra.department_id);

        const taskTypeWhere = {
            task_name: { [Op.ne]: 'Self Log' }
        };

        if (date) {
            taskTypeWhere[Op.and] = [
                { start_date: { [Op.lte]: `${date} 23:59:59` } },
                {
                    [Op.or]: [
                        { end_date: { [Op.gte]: `${date} 00:00:00` } },
                        { end_date: null }
                    ]
                }
            ];
        }

        // 2. Fetch Personal Assignments
        const personalAssignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                    { model: TaskType, where: taskTypeWhere, required: true },
                    { model: Venue }
                ]
            }]
        });

        const personalList = personalAssignments.map(a => ({
            ...a.toJSON(),
            role_context: 'Personal Assignment',
            source: 'personal'
        }));

        // 3. Fetch Venue Incharge Tasks
        let venueInchargeList = [];
        if (managedVenueIds.length > 0) {
            const venueTasks = await Task.findAll({
                where: {
                    is_deleted: false,
                    [Op.or]: [
                        { venue_id: { [Op.in]: managedVenueIds } },
                        literal(`(SELECT venue_id FROM task_types WHERE task_id = Task.task_id LIMIT 1) IN (${managedVenueIds.join(',')})`)
                    ]
                },
                include: [
                    { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                    { model: TaskType, where: taskTypeWhere, required: true },
                    { model: Venue },
                    { model: TaskAssign, include: [{ model: User, attributes: ['user_id', 'role'] }] }
                ]
            });

            const personalTaskIds = new Set(personalList.map(p => p.task_id));
            venueInchargeList = venueTasks
                .filter(t => !personalTaskIds.has(t.task_id))
                .map(t => ({
                    task_id: t.task_id,
                    status: t.status,
                    Task: t.toJSON(),
                    role_context: 'Venue Incharge Responsibility',
                    source: 'venue'
                }));
        }

        // 4. Fetch Department HOD Tasks
        let hodDeptList = [];
        if (managedDeptIds.length > 0) {
            // Find all users in these departments
            const [deptUsers] = await Task.sequelize.query(`
                SELECT user_id FROM students WHERE department_id IN (${managedDeptIds.join(',')})
                UNION
                SELECT user_id FROM faculties WHERE department_id IN (${managedDeptIds.join(',')})
            `);
            const deptUserIds = deptUsers.map(u => u.user_id);

            if (deptUserIds.length > 0) {
                const deptAssignments = await TaskAssign.findAll({
                    where: { 
                        user_id: { [Op.in]: deptUserIds },
                        user_id: { [Op.ne]: userId } // Don't duplicate personal assignments
                    },
                    include: [{
                        model: Task,
                        where: { is_deleted: false },
                        include: [
                            { model: User, as: 'Creator', attributes: ['user_id', 'role'] },
                            { model: TaskType, where: taskTypeWhere, required: true },
                            { model: Venue }
                        ]
                    }]
                });

                const existingTaskIds = new Set([...personalList, ...venueInchargeList].map(p => p.task_id));
                hodDeptList = deptAssignments
                    .filter(a => !existingTaskIds.has(a.task_id))
                    .map(a => ({
                        ...a.toJSON(),
                        role_context: 'Department HOD Responsibility',
                        source: 'department'
                    }));
            }
        }

        // 5. Consolidate and Paginate
        const fullList = [...personalList, ...venueInchargeList, ...hodDeptList].sort((a, b) => {
            const dateA = new Date(a.created_at || a.Task?.created_at || 0);
            const dateB = new Date(b.created_at || b.Task?.created_at || 0);
            return dateB - dateA;
        });

        const paginated = fullList.slice(offset, offset + limit);

        res.json(getPagingData({ count: fullList.length, rows: paginated }, page, limit));

    } catch (error) {
        console.error('getTasksAssignedToUser Error:', error);
        res.status(500).json({ message: error.message });
    }
};


// Approve Task — PUT /:id/approve
// Always approves. No body needed. Called by the Approve button.
exports.approveTask = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id, { include: [{ model: TaskType }] });
        if (!task) return res.status(404).json({ message: 'Task not found' });

        // Allow: admin OR the task's designated approver
        const isAdmin = userRole === 'admin';
        const isDesignatedApprover = String(task.approver_id) === String(userId);

        if (!isAdmin && !isDesignatedApprover) {
            return res.status(403).json({
                message: 'Only the designated approver or an admin can approve this task'
            });
        }

        // Find the TaskApprovalRequest so we can finalize and create assignments
        const { TaskApprovalRequest } = require('../models');
        const approvalRequest = await TaskApprovalRequest.findOne({
            where: { task_id: id, status: 'pending' }
        });

        if (approvalRequest) {
            await exports.finalizeTaskAssignments(approvalRequest);
            await approvalRequest.update({ status: 'approved' });
        } else {
            // No pending request — just mark as approved
            await task.update({
                is_approved: true,
                status: 'Active',
                stage: 'acceptance'
            });
        }

        await TaskLog.create({
            task_id: id,
            user_id: userId,
            action: 'approve',
            details: `Task approved by ${isAdmin ? 'admin' : 'designated approver'} (User ${userId}).`
        });

        res.json({ message: 'Task approved and assignments created successfully', task_id: id });

    } catch (error) {
        console.error('Error approving task:', error);
        res.status(500).json({ message: error.message });
    }
};

// Reject Task Approval — PUT /:id/reject-approval
// Separate endpoint for the Reject button.
exports.rejectTaskApproval = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id);
        if (!task) return res.status(404).json({ message: 'Task not found' });

        const isAdmin = userRole === 'admin';
        const isDesignatedApprover = String(task.approver_id) === String(userId);

        if (!isAdmin && !isDesignatedApprover) {
            return res.status(403).json({
                message: 'Only the designated approver or an admin can reject this task approval'
            });
        }

        await task.update({
            is_approved: false,
            status: 'Inactive',
            stage: 'approval_rejected'
        });

        // Mark the approval request as rejected too
        const { TaskApprovalRequest } = require('../models');
        await TaskApprovalRequest.update(
            { status: 'rejected' },
            { where: { task_id: id, status: 'pending' } }
        );

        await TaskLog.create({
            task_id: id,
            user_id: userId,
            action: 'reject_approval',
            details: `Approval rejected by User ${userId}. Reason: ${reason || 'No reason provided'}`
        });

        res.json({ message: 'Task approval rejected', task_id: id, reason: reason || null });

    } catch (error) {
        console.error('Error rejecting task approval:', error);
        res.status(500).json({ message: error.message });
    }
};

// Submit Task Proof
exports.startActivity = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;

        // Find assignment
        const assignment = await TaskAssign.findOne({
            where: {
                task_id: id,
                user_id: userId,
                status: { [Op.in]: ['pending', 'accepted'] }
            },
            include: [{
                model: Task,
                include: [{ model: TaskType }]
            }]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Eligible task assignment (pending or accepted) not found' });
        }

        const taskType = assignment.Task.TaskTypes && assignment.Task.TaskTypes[0];
        const now = new Date();

        // Window Enforcement
        if (taskType) {
            const dateStr = taskType.start_date ? new Date(taskType.start_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
            
            // 1. Start Time Check
            if (taskType.start_time) {
                const startDateTime = new Date(`${dateStr}T${taskType.start_time}`);
                if (now < startDateTime) {
                    return res.status(403).json({
                        message: 'Activity Cannot Be Started Yet',
                        details: `This task is scheduled to start at ${startDateTime.toLocaleString()}.`
                    });
                }
            }

            // 2. End Time Check (Deadline)
            if (taskType.end_date) {
                const endDateStr = new Date(taskType.end_date).toISOString().split('T')[0];
                const timeStr = taskType.end_time || '23:59:59';
                const deadline = new Date(`${endDateStr}T${timeStr}`);
                if (now > deadline) {
                    return res.status(400).json({ 
                        message: "Activity window has passed. This task is marked as missed.",
                        details: `Deadline was at ${deadline.toLocaleString()}.`
                    });
                }
            }
        }

        await assignment.update({
            status: 'in_progress'
        });

        // Update Task Stage to reflect activity start
        await assignment.Task.update({ stage: 'activity_end' });

        await TaskLog.create({
            task_id: id,
            user_id: userId,
            action: 'start_activity',
            details: 'Activity started manually'
        });

        // After starting activity, adjust long task status (it will pause any active long tasks)
        const { adjustLongTaskStatus } = require('../utils/task-utils');
        await adjustLongTaskStatus(userId);

        res.json({
            message: 'Activity started successfully',
            status: 'in_progress'
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.submitTaskProof = async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        let { proof, obtained_score, penalty: body_penalty } = req.body || {};

        if (req.file) {
            // Use relative path to ensure consistency and avoid IP-based fetching issues
            proof = `uploads/submissions/${req.file.filename}`;
        }

        // Find assignment
        const assignment = await TaskAssign.findOne({
            where: {
                task_id: id,
                user_id: userId,
                status: { [Op.in]: ['pending', 'accepted', 'in_progress'] }
            },
            include: [{
                model: Task,
                include: [{ model: TaskType }]
            }]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Eligible task assignment (pending or accepted) not found' });
        }

        const task = assignment.Task;
        const taskType = task.TaskTypes && task.TaskTypes[0];
        const isStudent = req.userRole === 'student';

        // 1. Enforce Start Task for non-students if proof is required
        if (!isStudent && task.is_document && assignment.status !== 'in_progress') {
            return res.status(400).json({ message: 'You must start the task before submitting proof.' });
        }

        // 2. Enforce deadlines for non-students
        const nowFinalCheck = new Date();
        if (!isStudent && assignment.resubmission_deadline) {
            if (nowFinalCheck > new Date(assignment.resubmission_deadline)) {
                await assignment.update({ 
                    status: 'completed', 
                    earned_score: 0, 
                    penalty_applied: task.score || 0 
                });
                return res.status(400).json({ message: 'Resubmission deadline has passed. Task has been closed with 0 points.' });
            }
        } else if (!isStudent && taskType) {
            const taskEndDate = new Date(taskType.end_date || taskType.start_date);
            const taskEndTime = taskType.end_time || '16:30:00';
            const endDateTime = new Date(`${taskEndDate.toISOString().split('T')[0]}T${taskEndTime}`);

            const now = new Date();
            const istOffset = 330 * 60 * 1000;
            const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

            if (localNow > endDateTime) {
                const elapsedWorkingMins = getWorkingMinutes(endDateTime, localNow);
                if (elapsedWorkingMins > 360) { // 6 hours
                    return res.status(400).json({ message: 'Deadline for proof submission (6 working hours) has passed. Task has been escalated.' });
                }
            }
        }

        // Check if proof is required based on the task type
        const isCreator = String(task.creator_id) === String(userId);
        if (task.is_document && !proof && !isCreator) {
            return res.status(400).json({ message: 'Proof/Document is required for this task' });
        }



        let penalty = 0;
        let earnedScore = 0;

        if (obtained_score !== undefined && body_penalty !== undefined) {
            penalty = parseFloat(body_penalty);
            earnedScore = parseFloat(obtained_score);
        } else {
            const now = new Date();
            const deadline = taskType.end_date ? new Date(taskType.end_date) : null;

            // Calculate penalty if late
            if (deadline && now > deadline) {
                const diffMs = now - deadline;
                const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
                penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
            }

            earnedScore = parseFloat(task.score || 0) - penalty;
        }

        // Update Assignment
        const nowFinal = new Date();
        const updatePayload = {
            proof,
            submitted_time: nowFinal
        };

        if (task.is_document) {
            updatePayload.verification_status = 'pending';
            // Keep status as whatever it currently is (or in_progress) to keep it strictly active
            if (assignment.status === 'pending' || assignment.status === 'accepted') {
                updatePayload.status = 'in_progress';
            }
        } else {
            updatePayload.status = 'completed';
            updatePayload.earned_score = earnedScore;
            updatePayload.penalty_applied = penalty;
            updatePayload.verification_status = 'verified'; // Auto-verify if no proof needed
        }

        await assignment.update(updatePayload);

        // Resolve any existing escalations for this user/task
        const { resolveTaskEscalations, adjustLongTaskStatus } = require('../utils/task-utils');
        await resolveTaskEscalations(id, userId);
        
        // Update Task Stage to verification or Inactive
        await task.update({ 
            stage: (task.is_document && !isCreator) ? 'verification' : 'Inactive',
            status: 'completed'
        });

        // Only allocate score if it's NOT pending verification
        if (!task.is_document) {
            // Update User Profile (Student, Faculty, or RoleUser)
            const user = await User.findByPk(userId);
            let profile = null;

            if (user.role === 'student') {
                profile = await Student.findOne({ where: { user_id: userId } });
            } else if (user.role === 'faculty') {
                profile = await Faculty.findOne({ where: { user_id: userId } });
            } else if (user.role === 'role-user') {
                profile = await RoleUser.findOne({ where: { user_id: userId } });
            } else if (user.role === 'staff') {
                profile = await Staff.findOne({ where: { user_id: userId } });
            }

            if (profile) {
                const currentScore = parseFloat(profile.score || 0); // Net Score
                const currentPenalty = parseFloat(profile.penalty || 0);
                const currentTotalScore = parseFloat(profile.total_score || 0); // Gross Score

                await profile.update({
                    score: currentScore + earnedScore, // Net + (Base - Penalty)
                    penalty: currentPenalty + penalty,
                    total_score: currentTotalScore + parseFloat(task.score) // Gross + Base
                });
            }
            
            // Rule: After completion, check if any paused long tasks can be resumed
            await adjustLongTaskStatus(userId);
        }

        await TaskLog.create({
            task_id: id,
            user_id: userId,
            action: task.is_document ? 'submit_proof_for_verification' : 'submit_proof',
            details: proof ? `Proof submitted: ${proof}` : 'Task completed without specific proof document.'
        });

        res.json({
            message: task.is_document ? 'Task proof submitted. Awaiting creator verification.' : 'Task submitted successfully',
            score_earned: task.is_document ? 0 : earnedScore,
            penalty_applied: task.is_document ? 0 : penalty,
            status: task.is_document ? 'in_progress' : 'completed',
            verification_status: task.is_document ? 'pending' : 'verified'
        });

        // Rule 8 & 11: Automatic Resume & Notifications
        (async () => {
            try {
                // 1. Notify Creator
                if (task.is_document) {
                    await Notification.create({
                        user_id: task.creator_id,
                        title: 'Proof Verification Required',
                        msg: `User ${userId} submitted proof for "${task.title}". Please review it.`,
                        type: 'task_submitted_pending_verification'
                    });
                } else {
                    await Notification.create({
                        user_id: task.creator_id,
                        title: 'Task Completed',
                        msg: `User ${userId} completed "${task.title}".`,
                        type: 'task_completed'
                    });
                }

                // 1.5. Trigger Next Sub-task (Sequential Package Logic)
                if (!task.is_document && task.parent_task_id) {
                    const nextSubTask = await Task.findOne({
                        where: { 
                            parent_task_id: task.parent_task_id,
                            sequence_order: task.sequence_order + 1,
                            is_deleted: false
                        },
                        include: [{ model: TaskType }]
                    });

                    if (nextSubTask) {
                        const nextTT = nextSubTask.TaskTypes?.[0];
                        if (nextTT && nextTT.max_duration_hours) {
                            const calculated = calculateEndWorkingDateTime(
                                new Date(),
                                new Date().toTimeString().split(' ')[0],
                                nextTT.max_duration_hours
                            );
                            if (calculated) {
                                await nextTT.update({
                                    start_date: new Date(),
                                    start_time: new Date().toTimeString().split(' ')[0],
                                    end_date: calculated.end_date,
                                    end_time: calculated.end_time
                                });
                            }
                        }

                        // Activate Task
                        await nextSubTask.update({ status: 'Active' });

                        // Activate Assignments
                        const nextAssignments = await TaskAssign.findAll({
                            where: { task_id: nextSubTask.task_id, status: 'queued' }
                        });

                        for (const na of nextAssignments) {
                            await na.update({ status: 'pending' });
                            
                            // Notify next assignee
                            await Notification.create({
                                user_id: na.user_id,
                                title: 'Task Activated',
                                msg: `Next phase "${nextSubTask.title}" in the package is now active for you.`,
                                type: 'task_created'
                            });
                        }
                    }
                }

                // 2. Resume Paused Long Tasks for this user
                const pausedTasks = await TaskAssign.findAll({
                    where: { user_id: userId },
                    include: [{
                        model: Task,
                        where: { status: 'PAUSED', is_paused: true, is_deleted: false }
                    }]
                });

                for (const pausedAssign of pausedTasks) {
                    const pTask = pausedAssign.Task;
                    // Simply resume the first paused task found for the user
                    // (Or we could be more specific by checking overlap dates, but usually users have one background long task)
                    await pTask.update({ status: 'Active', is_paused: false });
                    await TaskLog.create({
                        task_id: pTask.task_id,
                        user_id: userId,
                        action: 'resume',
                        details: `Automatically resumed after completion of "${task.title}" at ${new Date().toISOString()}`
                    });

                    await Notification.create({
                        user_id: userId,
                        title: 'Task Resumed',
                        msg: `Background task "${pTask.title}" has been automatically resumed.`,
                        type: 'task_resumed'
                    });
                }
            } catch (notifyErr) {
                console.error('Post-completion background logic error:', notifyErr);
            }
        })();

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get escalated tasks for a creator
exports.getEscalatedTasksForCreator = async (req, res) => {
    try {
        const userId = req.userId;
        const tasks = await Task.findAll({
            where: { creator_id: userId, is_escalate: true, is_deleted: false },
            include: [{ model: TaskType }]
        });
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get formal rejection escalations for a creator (using new model)
exports.getRejectionEscalationsForCreator = async (req, res) => {
    try {
        const userId = req.userId;
        const escalations = await TaskEscalation.findAll({
            where: { creator_id: userId },
            include: [
                { model: Task, attributes: ['task_id', 'title'] },
                {
                    model: User,
                    as: 'RejectedUser',
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'email'] },
                        { model: Faculty, attributes: ['name', 'email'] },
                        { model: Staff, attributes: ['name', 'email'] },
                        { model: RoleUser, attributes: ['name', 'email'] },
                        { model: AuthAccount, attributes: ['email'] }
                    ]
                }
            ],
            order: [['created_at', 'DESC']]
        });

        const formatted = escalations.map(e => {
            const u = e.RejectedUser;
            const details = u.Student || u.Faculty || u.Staff || u.RoleUser;

            let name = details?.name;
            const email = details?.email || u.AuthAccount?.email;

            if (!name) {
                if (u.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                escalation_id: e.id,
                task_id: e.task_id,
                task_title: e.Task?.title,
                reason: e.reason,
                status: e.status,
                created_at: e.created_at,
                rejected_by: {
                    user_id: u.user_id,
                    role: u.role,
                    name: name,
                    email: email || 'Unknown'
                }
            };
        });

        res.json({
            count: formatted.length,
            escalations: formatted
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get escalation report for a specific task
exports.getTaskEscalationReport = async (req, res) => {
    try {
        const { id } = req.params;
        const pendingUsers = await TaskAssign.findAll({
            where: { task_id: id, status: 'pending' },
            include: [{
                model: User,
                attributes: ['user_id', 'role'],
                include: [
                    { model: Student, attributes: ['name', 'email'] },
                    { model: Faculty, attributes: ['name', 'email'] },
                    { model: RoleUser, attributes: ['name', 'email'] },
                    { model: Staff, attributes: ['name', 'email'] },
                    { model: AuthAccount, attributes: ['email'] }
                ]
            }]
        });

        const users = pendingUsers.map(assignment => {
            const u = assignment.User;
            const details = u.Student || u.Faculty || u.RoleUser || u.Staff;

            let name = details?.name;
            const email = details?.email || u.AuthAccount?.email;

            if (!name) {
                if (u.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                user_id: u.user_id,
                role: u.role,
                name: name,
                email: email || 'Unknown'
            };
        });

        res.json({
            task_id: id,
            pending_count: users.length,
            pending_users: users
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Manually escalate a task
exports.manualEscalateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Only creator or admin can manually escalate
        if (task.creator_id !== userId && userRole !== 'admin') {
            return res.status(403).json({ message: 'Only the creator or an admin can manually escalate this task' });
        }

        await task.update({ is_escalate: true, status: 'Active' });

        // Get the report to return immediately
        const pendingAssignments = await TaskAssign.findAll({
            where: { task_id: id, status: 'pending' },
            include: [{
                model: User,
                attributes: ['user_id', 'role'],
                include: [
                    { model: Student, attributes: ['name', 'email'] },
                    { model: Faculty, attributes: ['name', 'email'] },
                    { model: RoleUser, attributes: ['name', 'email'] },
                    { model: Staff, attributes: ['name', 'email'] },
                    { model: AuthAccount, attributes: ['email'] }
                ]
            }]
        });

        const users = pendingAssignments.map(assignment => {
            const u = assignment.User;
            const details = u.Student || u.Faculty || u.RoleUser || u.Staff;

            let name = details?.name;
            const email = details?.email || u.AuthAccount?.email;

            if (!name) {
                if (u.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                user_id: u.user_id,
                role: u.role,
                name: name,
                email: email || 'Unknown'
            };
        });

        res.json({
            message: 'Task manually escalated',
            task_id: id,
            pending_count: users.length,
            pending_users: users
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Create Unified Task (Task + Type + Assignment + Closure)
exports.createUnifiedTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const userId = req.userId;
        const userRole = req.userRole;
        // const { Op } = require('sequelize'); // Already imported at the top

        if (!canCreateTask(userRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'You do not have permission to create tasks' });
        }

        // Use normalization helper
        const payload = await normalizeTaskPayload(req.body);
        let {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            is_approved, approver_id,
            resource_id, is_faculty, faculty_id,
            task_type_data,
            assignee_ids, // [1, 2, 3] or single ID
            assign_to_groups, // [ { role: 'STUDENT', department_id: 1 }, { role: 'STAFF' } ]
            closure_ids, // [1, 2]
            task_title_id, // NEW: ID of the master title
            origin_type, // 'directive' or 'self-log'
            sub_tasks, // NEW: [ { title, description, assignee_id, assignee_ids }, ... ]
            requires_approval, // NEW: if true, task goes for approval before being created
            max_duration_hours,
            due_date // NEW: Explictly extract due_date to fix ReferenceError
        } = payload;

        // Normalization is now handled by normalizeTaskPayload helper

        // --- NEW: Category Normalization ---
        const categoryMap = {
            'Administrative': 'Admin',
            'administrative': 'Admin',
            'admin': 'Admin',
            'Academic': 'Academic',
            'academic': 'Academic',
            'Compliance': 'Compliance',
            'compliance': 'Compliance',
            'Others': 'Others',
            'others': 'Others'
        };
        if (category && categoryMap[category]) {
            category = categoryMap[category];
        } else if (category && (category.toLowerCase() === 'admin' || category.toLowerCase() === 'administrative')) {
            category = 'Admin';
        }

        // Force self-log for students/staff if not specified or as a restriction
        if (userRole?.toLowerCase() === 'student' || userRole?.toLowerCase() === 'staff') {
            origin_type = 'self-log';
            // Auto-assign to self if it's a self-log
            if (!assignee_ids) assignee_ids = [userId];
            else if (Array.isArray(assignee_ids) && !assignee_ids.includes(userId)) assignee_ids.push(userId);
            else if (typeof assignee_ids === 'number' && assignee_ids !== userId) assignee_ids = [assignee_ids, userId];
        }

        // Apply restrictions based on origin_type
        if (origin_type === 'self-log') {
            // Self-logs have no score or penalty
            score = 0;
            penalty_per_hour = 0;
        } else {
            // Directive tasks must have a future deadline
            const now = new Date();

            // For package tasks, use the due_date as the real deadline (sub-tasks can span beyond task window)
            // For regular tasks, use the task_type_data end date/time
            let deadlineDate = null;
            if (is_package && due_date) {
                deadlineDate = new Date(due_date);
                deadlineDate.setHours(23, 59, 59, 0); // end of due_date day
            } else {
                const endDateStr = task_type_data?.end_date || task_type_data?.start_date;
                if (endDateStr) {
                    deadlineDate = new Date(endDateStr);
                    const endTimeStr = task_type_data?.end_time || '23:59:59';
                    const [hours, minutes] = endTimeStr.split(':');
                    const h = parseInt(hours);
                    const m = parseInt(minutes);
                    if (!isNaN(h) && !isNaN(m)) {
                        deadlineDate.setHours(h, m, 0, 0);
                    }
                }
            }

            if (deadlineDate) {
                // Add a 5-minute buffer to accommodate slight clock drifts or slow page submissions
                const bufferNow = new Date(now.getTime() - (5 * 60 * 1000));
                if (deadlineDate < bufferNow) {
                    await t.rollback();
                    return res.status(400).json({ message: 'Directive tasks must have a future deadline. For past activities, use Self-Log.' });
                }
            }
        }


        // Redundant parsing logic removed (handled by normalizeTaskPayload)

        // --- NEW: Handle Master Task Title ---
        if (task_title_id) {
            const masterTitle = await TaskTitle.findByPk(task_title_id);
            if (masterTitle) {
                title = title || masterTitle.task_title;
                // Update payload so validation below passes and it persists correctly
                payload.title = title;
            }
        }

        if (!title || !category || !priority || !task_type_data || !task_type_data.task_name) {
            await t.rollback();
            return res.status(400).json({ message: 'Missing required task or type fields' });
        }

        if (requires_approval && !approver_id) {
            await t.rollback();
            return res.status(400).json({ message: 'Approver ID is required when task needs approval' });
        }

        validateTaskType(task_type_data, priority);

        // --- PRE-CALCULATE ASSIGNEES ---
        // Ensure payload.assignee_ids is an array and stays in sync
        if (!payload.assignee_ids) payload.assignee_ids = [];
        if (!Array.isArray(payload.assignee_ids)) payload.assignee_ids = [payload.assignee_ids];

        let finalAssigneeIds = [...payload.assignee_ids];

        if (assign_to_groups && Array.isArray(assign_to_groups)) {
            for (const group of assign_to_groups) {
                let users = [];
                const { role, department_id } = group;
                const normalizedRole = role ? role.toUpperCase() : null;

                if (normalizedRole === 'STUDENT') {
                    users = await Student.findAll({ where: department_id ? { department_id } : {} });
                } else if (normalizedRole === 'FACULTY') {
                    users = await Faculty.findAll({ where: department_id ? { department_id } : {} });
                } else if (normalizedRole === 'HOD') {
                    const hodRole = await Role.findOne({ where: { user_role: 'HOD' } });
                    if (hodRole) {
                        const ra = await RoleAssignment.findAll({
                            where: { role_id: hodRole.role_id, ...(department_id && { department_id }) }
                        });
                        users = ra;
                    }
                } else if (normalizedRole === 'STAFF') {
                    users = await Staff.findAll();
                } else {
                    const targetRole = await Role.findOne({ where: { user_role: role } });
                    if (targetRole) {
                        const ra = await RoleAssignment.findAll({
                            where: { role_id: targetRole.role_id, ...(department_id && { department_id }) }
                        });
                        users = ra;
                    }
                }
                users.forEach(u => { if (u.user_id && !finalAssigneeIds.includes(u.user_id * 1)) finalAssigneeIds.push(u.user_id * 1); });
            }
        }

        // --- NEW: Faculty Ownership Logic (Unified with normalization) ---
        let facultyUserId = null;
        if (is_faculty && faculty_id) {
            const facultyRecord = await Faculty.findByPk(faculty_id);
            if (facultyRecord && facultyRecord.user_id) {
                facultyUserId = facultyRecord.user_id * 1;
                // Redundant check since normalizeTaskPayload already adds it, 
                // but good for safety if assignee_ids were cleared somehow.
                if (!finalAssigneeIds.includes(facultyUserId)) {
                    finalAssigneeIds.push(facultyUserId);
                }
            }
        }

        if (req.file) {
            try {
                const workbook = XLSX.readFile(req.file.path);
                const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
                for (const row of data) {
                    const { email, user_id, name } = row;
                    let excelUserId = user_id;

                    if (!excelUserId && email) {
                        const profiles = await Promise.all([
                            Student.findOne({ where: { email } }),
                            Faculty.findOne({ where: { email } }),
                            RoleUser.findOne({ where: { email } }),
                            Staff.findOne({ where: { email } })
                        ]);
                        excelUserId = profiles.find(p => p)?.user_id;
                    }

                    if (!excelUserId && name) {
                        const profiles = await Promise.all([
                            Student.findOne({ where: { name } }),
                            Faculty.findOne({ where: { name } }),
                            RoleUser.findOne({ where: { name } }),
                            Staff.findOne({ where: { name } })
                        ]);
                        excelUserId = profiles.find(p => p)?.user_id;
                    }

                    if (excelUserId) {
                        const numericId = parseInt(excelUserId);
                        if (!isNaN(numericId) && !finalAssigneeIds.includes(numericId)) {
                            finalAssigneeIds.push(numericId);
                            // Also update payload so it persists in Approval Request
                            if (!payload.assignee_ids.includes(numericId)) payload.assignee_ids.push(numericId);
                        }
                    }
                }
            } catch (e) { console.error('Excel processing error:', e); }
        }

        // --- NEW: Add Sub-task Assignees to Parent if it's a Package ---
        if (is_package && sub_tasks && Array.isArray(sub_tasks)) {
            for (const sub of sub_tasks) {
                const subAssigneeId = sub.user_id || sub.assignee_id;
                if (subAssigneeId) {
                    const sid = parseInt(subAssigneeId);
                    if (!isNaN(sid) && !finalAssigneeIds.includes(sid)) {
                        finalAssigneeIds.push(sid);
                        if (!payload.assignee_ids.includes(sid)) payload.assignee_ids.push(sid);
                    }
                }
                if (sub.assignee_ids && Array.isArray(sub.assignee_ids)) {
                    sub.assignee_ids.forEach(sid => {
                        const numericId = parseInt(sid);
                        if (!isNaN(numericId) && !finalAssigneeIds.includes(numericId)) {
                            finalAssigneeIds.push(numericId);
                            if (!payload.assignee_ids.includes(numericId)) payload.assignee_ids.push(numericId);
                        }
                    });
                }
            }
        }

        // --- BATCH FETCH ASSIGNEE ROLES ---
        const allInvolvedIds = [...finalAssigneeIds];
        const roleMap = {};
        if (allInvolvedIds.length > 0) {
            const assigneeProfiles = await User.findAll({
                where: { user_id: { [Op.in]: allInvolvedIds } },
                attributes: ['user_id', 'role']
            });
            assigneeProfiles.forEach(u => { roleMap[u.user_id] = u.role; });
        }

        // --- CALCULATE DATES FOR EXPANSION ---
        const occurrenceDates = [];
        const start = new Date(task_type_data.start_date);
        const end = task_type_data.end_date ? new Date(task_type_data.end_date) : start;
        const recurrence = task_type_data.recurrence || 'none';

        if (task_type_data.task_name === 'Recurring Task' && recurrence !== 'none') {
            let current = new Date(start);
            while (current <= end) {
                // Strictly skip Sundays as per user requirement
                if (current.getDay() !== 0) {
                    occurrenceDates.push(new Date(current));
                }

                if (recurrence === 'daily') current.setDate(current.getDate() + 1);
                else if (recurrence === 'weekly') current.setDate(current.getDate() + 7);
                else if (recurrence === 'monthly') current.setMonth(current.getMonth() + 1);
                else break;

                // Safety limit: Max 365 occurrences per creation
                if (occurrenceDates.length >= 365) break;
            }
        } else {
            // Validate single task date is not Sunday
            if (start.getDay() === 0) {
                await t.rollback();
                return res.status(400).json({ message: 'Task cannot be created on a Sunday (Holiday).' });
            }
            occurrenceDates.push(start);
        }

        // Rule 10: Preliminary Recurring Conflict Check (Optional/Proposed)
        // We'll handle this during the per-assignee assignment loop below for better precision.

        // --- BATCH CREATION ---
        // --- NEW: Force Mandatory for Staff ---
        // Rule: If any assignee is a Staff member, the task is always mandatory.
        let effectiveIsMandatory = is_mandatory || false;
        const hasStaffInGroup = assign_to_groups && Array.isArray(assign_to_groups) && assign_to_groups.some(g => g.role === 'STAFF');
        const hasStaffInAssignees = finalAssigneeIds.some(id => roleMap[id]?.toLowerCase() === 'staff');
        
        if (hasStaffInGroup || hasStaffInAssignees) {
            effectiveIsMandatory = true;
        }

        const createdTaskIds = [];

        for (const oDate of occurrenceDates) {
            // 1. Create Parent Task
            const parentTask = await Task.create({
                title, description, category, priority,
                task_title_id: task_title_id || null,
                is_package: is_package || false,
                venue_id: venue_id || null,
                is_pause_allowed: is_pause_allowed || false,
                score: score || 0,
                penalty_per_hour: penalty_per_hour || 0,
                is_document: is_document || false,
                is_mandatory: effectiveIsMandatory,
                is_approved: requires_approval ? false : true,
                approver_id: approver_id || null,
                resource_id: resource_id || null,
                is_faculty: is_faculty || false,
                faculty_id: faculty_id || null,
                creator_id: userId,
                origin_type: origin_type || 'directive',
                status: requires_approval ? 'Pending Approval' : 'Active',
                stage: requires_approval ? 'approval' : 'acceptance'
            }, { transaction: t });

            createdTaskIds.push(parentTask.task_id);

            // Auto-calculate end date/time for parent task if duration provided
            let parentFinalEndDate = (task_type_data.task_name === 'Recurring Task') ? oDate : (task_type_data.end_date || oDate);
            let parentFinalEndTime = task_type_data.end_time || null;

            if (task_type_data.time_quota_hours && !task_type_data.end_time) {
                const calculated = calculateEndWorkingDateTime(
                    oDate, // Use occurrence date for recurring tasks
                    task_type_data.start_time || '08:30:00',
                    task_type_data.time_quota_hours
                );
                if (calculated) {
                    parentFinalEndDate = calculated.end_date;
                    parentFinalEndTime = calculated.end_time;
                }
            }

            // 2. Create TaskType for Parent
            await TaskType.create({
                task_id: parentTask.task_id,
                task_name: task_type_data.task_name,
                start_date: oDate,
                end_date: parentFinalEndDate,
                start_time: task_type_data.start_time || null,
                end_time: parentFinalEndTime,
                time_quota_hours: task_type_data.time_quota_hours || null,
                max_duration_hours: max_duration_hours || null,
                venue_id: task_type_data.venue_id || null,
                recurrence: recurrence,
                max_acceptances: task_type_data.max_acceptances || null
            }, { transaction: t });

            // 4. Parent Task Assignment (to main assignees) - ONLY if not waiting for approval
            if (!requires_approval && finalAssigneeIds.length > 0) {
                const assignments = [];
                for (const assigneeId of finalAssigneeIds) {
                    // Skip if user was not found during batch fetch (e.g. non-existent or deleted)
                    if (!roleMap[assigneeId]) {
                        console.warn(`[createUnifiedTask] Skipping invalid/deleted assignee ID: ${assigneeId}`);
                        continue;
                    }

                    const allowed = await canAssignTo(userId, assigneeId);
                    const assigneeRole = roleMap[assigneeId];
                    const isStaff = assigneeRole === 'staff';
                    const isFacultySupervisor = (assigneeId === facultyUserId);

                    // Faculty members (even if they are supervisors) should NOT be auto-accepted 
                    // unless they are explicitly the creator of the task.
                    const isFacultyAssignee = assigneeRole === 'faculty';
                    const facultyAutoAccept = isFacultyAssignee ? (assigneeId === userId) : false;

                    // Auto-accept if it's mandatory (and not a faculty member being assigned by someone else), 
                    // or if it's staff.
                    // CRITICAL: Faculty members MUST always accept/reject manually, even if they are the creator.
                    let autoAccept = (effectiveIsMandatory && !isFacultyAssignee) || (isStaff && !isFacultyAssignee);
                    if (is_faculty) autoAccept = false;

                    if (!allowed) {
                        console.warn(`[createUnifiedTask] Skipping assignment for User:${assigneeId} (Role:${assigneeRole}) - Permission Denied by canAssignTo`);
                    }

                    if (allowed) {
                        let finalStatus = autoAccept ? 'accepted' : 'pending';
                        let finalAcceptedAt = autoAccept ? new Date() : null;

                        // If auto-accepting, enforce FULL overlap check for ALL user types
                        if (autoAccept) {
                            // 1. Daily Task Limit Check
                            const dailyCount = await TaskAssign.count({
                                where: { user_id: assigneeId, status: { [Op.in]: ['accepted', 'in_progress'] } },
                                include: [{
                                    model: Task,
                                    required: true,
                                    include: [{ model: TaskType, where: { start_date: oDate } }]
                                }]
                            });

                            if (dailyCount >= MAX_DAILY_TASKS) {
                                finalStatus = 'pending';
                                finalAcceptedAt = null;
                                await TaskEscalation.create({
                                    task_id: parentTask.task_id,
                                    reason: 'Daily Task Limit Reached',
                                    msg: `User ${assigneeId} already has ${MAX_DAILY_TASKS} tasks for ${oDate}. Auto-acceptance failed.`,
                                    creator_id: userId,
                                    rejected_user_id: assigneeId,
                                    status: 'pending'
                                }, { transaction: t });
                            } else {
                                // 2. Time Overlap Check — APPLIES TO ALL USERS (students, staff, faculty, role-users)
                                const overlap = await checkTaskOverlap(assigneeId, {
                                    start_date: oDate,
                                    end_date: parentFinalEndDate,
                                    start_time: task_type_data.start_time,
                                    end_time: parentFinalEndTime,
                                    task_name: task_type_data.task_name,
                                    priority: priority,
                                    origin_type: origin_type
                                }, parentTask.task_id);

                                if (overlap.hasConflict) {
                                    // NEW: Strict Overlap check for Self-Log and Directives
                                    if (overlap.type === 'strict_overlap') {
                                        await t.rollback();
                                        return res.status(400).json({
                                            message: 'Time Conflict Detected (Strict)',
                                            details: overlap.reason,
                                            conflict_task_id: overlap.conflictTask?.task_id
                                        });
                                    }

                                    // Downgrade from auto-accept to pending — user must resolve conflict manually
                                    finalStatus = 'pending';
                                    finalAcceptedAt = null;

                                    if (overlap.type === 'priority_override') {
                                        await TaskEscalation.create({
                                            task_id: parentTask.task_id,
                                            reason: `Priority Override Requested`,
                                            msg: `Task "${title}" (${priority}) requests to override "${overlap.conflictTask.title}" (${overlap.conflictTask.priority}) for User ${assigneeId}.`,
                                            creator_id: userId,
                                            rejected_user_id: assigneeId,
                                            status: 'pending'
                                        }, { transaction: t });

                                        await Notification.create({
                                            user_id: userId,
                                            title: 'Priority Override Potential',
                                            msg: `Your task "${title}" can override "${overlap.conflictTask.title}" for User ${assigneeId}. Approval required.`,
                                            type: 'priority_override_request'
                                        }, { transaction: t });
                                    } else {
                                        // Rule 10: Shift/Skip for Recurring Tasks
                                        if (task_type_data.task_name === 'Recurring Task') {
                                            console.log(`Skipping recurring instance for user ${assigneeId} due to conflict.`);
                                            continue; // Skip assignment for this user on this date
                                        }

                                        await TaskEscalation.create({
                                            task_id: parentTask.task_id,
                                            reason: overlap.type === 'work_hours' ? 'Work Hours Violation' : `Time Conflict with "${overlap.conflictTask?.title}"`,
                                            msg: overlap.reason || `Time conflict for User ${assigneeId} with "${overlap.conflictTask?.title}". Auto-acceptance downgraded to pending.`,
                                            creator_id: userId,
                                            rejected_user_id: assigneeId,
                                            status: 'pending'
                                        }, { transaction: t });
                                    }
                                }
                            }
                        }

                        assignments.push({
                            task_id: parentTask.task_id,
                            user_id: assigneeId,
                            status: finalStatus,
                            accepted_at: finalAcceptedAt
                        });

                        if (assigneeRole !== 'student') {
                            await Notification.create({
                                user_id: assigneeId,
                                title: 'New Task Assigned',
                                msg: `You have been assigned a new task: ${title}`,
                                type: 'task_created'
                            }, { transaction: t });
                        }
                    }
                }
                if (assignments.length > 0) {
                    await TaskAssign.bulkCreate(assignments, { transaction: t, ignoreDuplicates: true });
                }
            }

            // 4. Handle Sub-Tasks (Child Tasks)
            if (is_package && sub_tasks && Array.isArray(sub_tasks)) {
                let sequenceOrder = 1;
                for (const sub of sub_tasks) {
                    const childTask = await Task.create({
                        title: sub.title || `Sub-task for ${title}`,
                        description: sub.description || description,
                        category: category,
                        priority: priority,
                        is_package: false,
                        parent_task_id: parentTask.task_id,
                        venue_id: sub.venue_id || venue_id || null,
                        score: sub.score || 0,
                        penalty_per_hour: sub.penalty_per_hour || 0,
                        is_document: sub.is_document !== undefined ? (sub.is_document === true || sub.is_document === 'true') : (is_document || false),
                        is_mandatory: sub.is_mandatory || effectiveIsMandatory || false,
                        is_approved: requires_approval ? false : true,
                        approver_id: requires_approval ? approver_id : null,
                        creator_id: userId,
                        origin_type: origin_type || 'directive',
                        status: requires_approval ? 'Pending Approval' : (sequenceOrder === 1 ? 'Active' : 'Inactive'),
                        sequence_order: sequenceOrder++,
                        stage: requires_approval ? 'approval' : 'acceptance'
                    }, { transaction: t });

                    const isFirstSub = (childTask.sequence_order === 1);

                    let childFinalEndDate = sub.end_date || sub.start_date || oDate;
                    let childFinalEndTime = sub.end_time || null;

                    // If it's the 1st sub-task and has max_duration_hours, calculate absolute deadline NOW
                    if (isFirstSub && (sub.max_duration_hours || sub.max_hours || sub.allocated_hours)) {
                        const mHours = sub.max_duration_hours || sub.max_hours || sub.allocated_hours;
                        const calculated = calculateEndWorkingDateTime(
                            new Date(),
                            new Date().toTimeString().split(' ')[0],
                            mHours
                        );
                        if (calculated) {
                            childFinalEndDate = calculated.end_date;
                            childFinalEndTime = calculated.end_time;
                        }
                    }

                    await TaskType.create({
                        task_id: childTask.task_id,
                        task_name: sub.task_name || 'Fixed Time Task',
                        start_date: isFirstSub ? new Date() : (sub.start_date || oDate),
                        end_date: childFinalEndDate,
                        start_time: isFirstSub ? new Date().toTimeString().split(' ')[0] : (sub.start_time || task_type_data.start_time || null),
                        end_time: childFinalEndTime || sub.end_time || task_type_data.end_time || null,
                        max_duration_hours: sub.max_duration_hours || sub.max_hours || sub.allocated_hours || null,
                        venue_id: sub.venue_id || venue_id || null,
                        recurrence: recurrence // Match parent recurrence
                    }, { transaction: t });

                    // Assign sub-task to specific people
                    const subAssigneeIds = [];
                    const subAssigneeId = sub.user_id || sub.assignee_id;
                    if (subAssigneeId) {
                        const sid = parseInt(subAssigneeId);
                        if (!isNaN(sid)) subAssigneeIds.push(sid);
                    }
                    if (sub.assignee_ids && Array.isArray(sub.assignee_ids)) {
                        sub.assignee_ids.forEach(sid => {
                            const numericId = parseInt(sid);
                            if (!isNaN(numericId) && !subAssigneeIds.includes(numericId)) subAssigneeIds.push(numericId);
                        });
                    }

                    if (!requires_approval && subAssigneeIds.length > 0) {
                        const childAssignments = [];
                        for (const sid of subAssigneeIds) {
                            // Skip if user was not found during batch fetch
                            if (!roleMap[sid]) {
                                console.warn(`[createUnifiedTask] Skipping invalid sub-assignee ID: ${sid}`);
                                continue;
                            }
                            const allowedChild = await canAssignTo(userId, sid);
                            if (!allowedChild) {
                                console.warn(`Assignment to user ${sid} for sub-task ${sub.title} skipped due to permissions.`);
                                continue;
                            }

                            const isChildStaff = roleMap[sid] === 'staff';
                            const isChildFaculty = roleMap[sid] === 'faculty';
                            const childFacultyAutoAccept = isChildFaculty ? (sid === userId) : false;

                            const childAutoAccept = (sub.is_mandatory && (!isChildFaculty || childFacultyAutoAccept)) || isChildStaff || childFacultyAutoAccept;

                            let finalChildStatus = childAutoAccept ? 'accepted' : 'pending';
                            let finalChildAcceptedAt = childAutoAccept ? new Date() : null;

                            // SEQUENTIAL LOGIC: Only the first sub-task is active/pending; others are 'queued'
                            if (childTask.sequence_order > 1) {
                                finalChildStatus = 'queued';
                                finalChildAcceptedAt = null;
                            }

                            if (childAutoAccept) {
                                // 1. Daily Task Limit Check
                                const childDailyCount = await TaskAssign.count({
                                    where: { user_id: sid, status: { [Op.in]: ['accepted', 'in_progress'] } },
                                    include: [{
                                        model: Task,
                                        required: true,
                                        include: [{ model: TaskType, where: { start_date: sub.start_date || oDate } }]
                                    }]
                                });

                                if (childDailyCount >= MAX_DAILY_TASKS) {
                                    finalChildStatus = 'pending';
                                    finalChildAcceptedAt = null;
                                    await TaskEscalation.create({
                                        task_id: childTask.task_id,
                                        reason: 'Daily Task Limit Reached',
                                        msg: `User ${sid} already has ${MAX_DAILY_TASKS} tasks for ${oDate}. Auto-acceptance failed for sub-task.`,
                                        creator_id: userId,
                                        rejected_user_id: sid,
                                        status: 'pending'
                                    }, { transaction: t });
                                } else {
                                    const overlapChild = await checkTaskOverlap(sid, {
                                        start_date: sub.start_date || oDate,
                                        end_date: sub.end_date || oDate,
                                        start_time: sub.start_time || task_type_data.start_time,
                                        end_time: sub.end_time || task_type_data.end_time,
                                        task_name: sub.task_name || 'Fixed Time Task',
                                        priority: priority,
                                        origin_type: origin_type
                                    }, childTask.task_id);

                                    if (overlapChild.hasConflict) {
                                        // NEW: Strict Overlap check for sub-tasks
                                        if (overlapChild.type === 'strict_overlap') {
                                            await t.rollback();
                                            return res.status(400).json({
                                                message: 'Time Conflict Detected (Strict)',
                                                details: overlapChild.reason,
                                                conflict_task_id: overlapChild.conflictTask?.task_id
                                            });
                                        }

                                        finalChildStatus = 'pending';
                                        finalChildAcceptedAt = null;

                                        if (overlapChild.type === 'priority_override') {
                                            await TaskEscalation.create({
                                                task_id: childTask.task_id,
                                                reason: `Priority Override Requested (Sub-task)`,
                                                msg: `Sub-task "${childTask.title}" (${priority}) requests to override "${overlapChild.conflictTask.title}" for User ${sid}.`,
                                                creator_id: userId,
                                                rejected_user_id: sid,
                                                status: 'pending'
                                            }, { transaction: t });
                                        } else {
                                            await TaskEscalation.create({
                                                task_id: childTask.task_id,
                                                reason: overlapChild.type === 'work_hours' ? 'Work Hours Violation' : 'Conflict: Mandatory Sub-task Blocked',
                                                msg: overlapChild.reason || `Sub-task Conflict for User ${sid} with "${overlapChild.conflictTask?.title}".`,
                                                creator_id: userId,
                                                rejected_user_id: sid,
                                                status: 'pending'
                                            }, { transaction: t });
                                        }
                                    }
                                }
                            }

                            childAssignments.push({
                                task_id: childTask.task_id,
                                user_id: sid,
                                status: finalChildStatus,
                                accepted_at: finalChildAcceptedAt
                            });

                            if (finalChildStatus !== 'queued') {
                                await Notification.create({
                                    user_id: sid,
                                    title: 'New Sub-task Assigned',
                                    msg: `You have been assigned a sub-task: ${sub.title} within ${title}`,
                                    type: 'task_created'
                                }, { transaction: t });
                            }
                        }

                        if (childAssignments.length > 0) {
                            await TaskAssign.bulkCreate(childAssignments, { transaction: t, ignoreDuplicates: true });
                        }
                    }
                }
            }

            // 5. Venue Logic (Special Permission/Assignment for Incharge) - ONLY IF NOT WAITING FOR APPROVAL
            if (!requires_approval) {
                // Collect unique venue IDs from parent and sub-tasks
                const venuesToRequest = new Set();
                if (venue_id) venuesToRequest.add(venue_id);
                if (is_package && sub_tasks && Array.isArray(sub_tasks)) {
                    sub_tasks.forEach(st => { if (st.venue_id) venuesToRequest.add(st.venue_id); });
                }

                for (const vid of venuesToRequest) {
                    const inchargers = await RoleAssignment.findAll({
                        where: { venue_id: vid },
                        include: [{ model: Role, where: { user_role: { [Op.like]: '%INCHARGE%' } } }]
                    });

                    if (inchargers.length === 0) continue;

                    let targetTaskId = parentTask.task_id;

                    // If it's a package, or if the venue is from a sub-task, create a separate permission task
                    // to avoid cluttering the main task's assignee list with inchargers who are just "approvers".
                    const needsSeparatePermission = is_package || (vid !== venue_id);

                    if (needsSeparatePermission) {
                        const venueTask = await Task.create({
                            title: `Permission: ${title} at Venue`,
                            description: `Approval required for venue reservation.`,
                            category: 'Admin',
                            priority: 'high',
                            is_package: false,
                            parent_task_id: parentTask.task_id,
                            venue_id: vid,
                            creator_id: userId,
                            status: 'Active',
                            stage: 'Active'
                        }, { transaction: t });

                        await TaskType.create({
                            task_id: venueTask.task_id,
                            task_name: 'Permission Request',
                            start_date: oDate,
                            end_date: (task_type_data.task_name === 'Recurring Task') ? oDate : (task_type_data.end_date || oDate),
                            start_time: task_type_data.start_time,
                            end_time: task_type_data.end_time,
                            venue_id: vid,
                            recurrence: recurrence // Match parent recurrence
                        }, { transaction: t });

                        targetTaskId = venueTask.task_id;
                    }

                    for (const ra of inchargers) {
                        if (!ra.user_id) continue;
                        const isAlreadyAssignedToMain = finalAssigneeIds.includes(ra.user_id * 1);

                        // If it's the main task and they are already assigned, we don't need to add them again as pending
                        if (!needsSeparatePermission && isAlreadyAssignedToMain) continue;

                        await TaskAssign.create({
                            task_id: targetTaskId,
                            user_id: ra.user_id,
                            status: 'pending'
                        }, { transaction: t });

                        await Notification.create({
                            user_id: ra.user_id,
                            title: 'Venue Booking Requires Your Approval',
                            msg: `A new booking "${title}" has been requested for your venue.`,
                            type: 'task_created'
                        }, { transaction: t });
                    }
                }
            }

            // 6. Notify Creator
            await Notification.create({
                user_id: userId,
                title: 'Task Created Successfully',
                msg: `Task "${title}" ${is_package ? 'and its sub-tasks' : ''} have been created.`,
                type: 'task_created'
            }, { transaction: t });

            // 7. Handle Self-Log - ONLY IF NOT WAITING FOR APPROVAL
            if (!requires_approval && origin_type === 'self-log') {
                const submittedTime = task_type_data.start_date ? new Date(task_type_data.start_date) : new Date();
                if (task_type_data.start_time) {
                    const [h, m] = task_type_data.start_time.split(':');
                    submittedTime.setHours(parseInt(h), parseInt(m), 0, 0);
                }

                await TaskAssign.upsert({
                    task_id: parentTask.task_id,
                    user_id: userId,
                    status: 'completed',
                    accepted_at: submittedTime,
                    submitted_time: submittedTime,
                    earned_score: 0,
                    penalty_applied: 0
                }, { transaction: t });
            }

            // 8. Closure Rules
            if (closure_ids && Array.isArray(closure_ids) && closure_ids.length > 0) {
                const closures = closure_ids.map(cid => ({ task_id: parentTask.task_id, closure_id: cid }));
                await TaskPackageClosure.bulkCreate(closures, { transaction: t });
            } else {
                // --- NEW: Default OTP Closure for Students ---
                // If no specific closures are provided, and any assignee is a student, 
                // link the 'OTP' closure by default.
                const hasStudentAssignee = finalAssigneeIds.some(id => roleMap[id] === 'student');
                if (hasStudentAssignee || userRole?.toLowerCase() === 'student') {
                    const otpClosure = await TaskClosure.findOne({ where: { name: 'OTP' } });
                    if (otpClosure) {
                        await TaskPackageClosure.create({
                            task_id: parentTask.task_id,
                            closure_id: otpClosure.id
                        }, { transaction: t });
                    }
                }
            }
        }

        // --- APPROVAL GATE AFTERCARE ---
        if (requires_approval) {
            const { TaskApprovalRequest, Notification, TaskAssign } = require('../models');

            // 1. Create Approval Request
            const savedRequest = await TaskApprovalRequest.create({
                approver_id: approver_id,
                creator_id: userId,
                task_payload: payload,
                task_id: createdTaskIds[0],
                task_ids: createdTaskIds,
                status: 'pending'
            }, { transaction: t });

            await Notification.create({
                user_id: approver_id,
                title: 'Task Approval Required',
                msg: `A new task "${title}" requires your approval.`,
                type: 'task_approval_request'
            }, { transaction: t });

            await t.commit();
            return res.status(202).json({
                message: 'Task created and awaiting approval. It is visible in your pending list.',
                task_id: createdTaskIds[0],
                approval_request_id: savedRequest.id
            });
        }

        await t.commit();

        await TaskLog.create({
            task_id: createdTaskIds[0], // Log the first one at least for the series
            user_id: userId,
            action: 'create_unified',
            details: `Unified task series created: ${title}. Count: ${occurrenceDates.length}`
        });

        res.status(201).json({
            message: `Successfully created ${occurrenceDates.length} occurrences for the task series.`,
            task_ids: createdTaskIds,
            occurrences: occurrenceDates.length,
            assigned_count: finalAssigneeIds.length
        });

    } catch (error) {
        await t.rollback();
        console.error('Error in createUnifiedTask:', error);

        // Return 400 for validation errors or explicit check failures
        if (error.message.includes('requires') || error.message.includes('fields') || error.message.includes('deadline') || error.message.includes('work hours')) {
            return res.status(400).json({ message: error.message });
        }

        res.status(500).json({ message: error.message });
    }
}; // end createUnifiedTask// end createUnifiedTask

// Finalize a task after approval (Create assignments and notify)
exports.finalizeTaskAssignments = async (approvalRequest, transaction = null) => {
    const { Task, TaskAssign, Notification, User, RoleAssignment, Role, TaskType } = require('../models');
    const { Op } = require('sequelize');
    const t = transaction || await Task.sequelize.transaction();

    try {
        const payload = await normalizeTaskPayload(approvalRequest.task_payload);
        const taskIds = approvalRequest.task_ids || [approvalRequest.task_id];

        // 1. Update all tasks to Active and Approved
        await Task.update({
            is_approved: true,
            status: 'Active',
            stage: 'Active'
        }, {
            where: { task_id: taskIds },
            transaction: t
        });

        // 2. Fetch one task to get common details if needed
        const sampleTask = await Task.findByPk(taskIds[0], { transaction: t });
        const title = sampleTask.title;
        const userId = sampleTask.creator_id;
        const approverId = approvalRequest.approver_id;

        // --- NEW: Update Approver's Assignment Status ---
        if (approverId) {
            await TaskAssign.update({
                status: 'accepted'
            }, {
                where: {
                    task_id: taskIds,
                    user_id: approverId
                },
                transaction: t
            });
        }

        // 3. Role Mapping for Assignments
        const { Student, Faculty, Staff, RoleUser } = require('../models');
        const allUserIds = [...new Set([
            ...(payload.assignee_ids || []),
            ...(payload.sub_tasks?.flatMap(st => [
                ...(st.assignee_ids || []), 
                st.user_id ? parseInt(st.user_id) : (st.assignee_id ? parseInt(st.assignee_id) : null)
            ]) || []).filter(id => id !== null)
        ])];

        const userProfiles = await Promise.all([
            Student.findAll({ where: { user_id: allUserIds }, attributes: ['user_id'], transaction: t }),
            Faculty.findAll({ where: { user_id: allUserIds }, attributes: ['user_id'], transaction: t }),
            Staff.findAll({ where: { user_id: allUserIds }, attributes: ['user_id'], transaction: t }),
            RoleUser.findAll({ where: { user_id: allUserIds }, attributes: ['user_id'], transaction: t })
        ]);

        const roleMap = {};
        userProfiles[0].forEach(p => roleMap[p.user_id] = 'student');
        userProfiles[1].forEach(p => roleMap[p.user_id] = 'faculty');
        userProfiles[2].forEach(p => roleMap[p.user_id] = 'staff');
        userProfiles[3].forEach(p => roleMap[p.user_id] = 'role-user');

        // 4. Process Assignments for each task occurrence
        for (const taskId of taskIds) {
            // Get finalAssigneeIds (Already normalized in payload)
            let finalAssigneeIds = [...(payload.assignee_ids || [])];

            // Logic for sub-tasks if package
            if (payload.is_package && payload.sub_tasks) {
                // Find child tasks
                const childTasks = await Task.findAll({ where: { parent_task_id: taskId }, transaction: t });

                for (const sub of payload.sub_tasks) {
                    const childTask = childTasks.find(ct => ct.title === (sub.title || `Sub-task for ${title}`));
                    if (!childTask) continue;

                    // Update child task
                    await childTask.update({ is_approved: true, status: 'Active', stage: 'Active' }, { transaction: t });

                    const subAssigneeIds = [];
                    const sidFromPayload = sub.user_id || sub.assignee_id;
                    if (sidFromPayload) subAssigneeIds.push(parseInt(sidFromPayload));
                    if (sub.assignee_ids) sub.assignee_ids.forEach(id => subAssigneeIds.push(parseInt(id)));

                    for (const sid of [...new Set(subAssigneeIds)]) {
                        if (isNaN(sid) || !roleMap[sid]) continue;

                        const isChildStaff = roleMap[sid] === 'staff';
                        const isChildFaculty = roleMap[sid] === 'faculty';
                        const childFacultyAutoAccept = isChildFaculty ? (sid === userId) : false;
                        const childAutoAccept = (sub.is_mandatory && (!isChildFaculty || childFacultyAutoAccept)) || isChildStaff || childFacultyAutoAccept;

                        let finalChildStatus = childAutoAccept ? 'accepted' : 'pending';
                        if (childTask.sequence_order > 1) {
                            finalChildStatus = 'queued';
                        }

                        await TaskAssign.create({
                            task_id: childTask.task_id,
                            user_id: sid,
                            status: finalChildStatus,
                            accepted_at: finalChildAcceptedAt = (finalChildStatus === 'accepted' ? new Date() : null)
                        }, { transaction: t });

                        await Notification.create({
                            user_id: sid,
                            title: 'New Task Assigned',
                            msg: `You have been assigned a new sub-task: ${childTask.title}`,
                            type: 'task_created'
                        }, { transaction: t });
                    }
                }
            }

            // Main task assignments
            for (const assigneeId of finalAssigneeIds) {
                if (!roleMap[assigneeId]) continue;

                const isStaff = roleMap[assigneeId] === 'staff';
                const isFacultyAssignee = roleMap[assigneeId] === 'faculty';
                const facultyAutoAccept = isFacultyAssignee ? (assigneeId === userId) : false;
                let autoAccept = (payload.is_mandatory && (!isFacultyAssignee || facultyAutoAccept)) || isStaff || facultyAutoAccept;
                if (payload.is_faculty) autoAccept = false;

                const finalStatus = autoAccept ? 'accepted' : 'pending';

                await TaskAssign.create({
                    task_id: taskId,
                    user_id: assigneeId,
                    status: finalStatus,
                    accepted_at: autoAccept ? new Date() : null
                }, { transaction: t });

                await Notification.create({
                    user_id: assigneeId,
                    title: 'New Task Assigned (Approved)',
                    msg: `A task "${title}" has been approved and assigned to you.`,
                    type: 'task_created'
                }, { transaction: t });
            }

            // --- NEW: Post-Approval Venue Incharge Logic ---
            const venuesToRequest = new Set();
            if (payload.venue_id) venuesToRequest.add(payload.venue_id);
            if (payload.is_package && payload.sub_tasks) {
                payload.sub_tasks.forEach(st => { if (st.venue_id) venuesToRequest.add(st.venue_id); });
            }

            for (const vid of venuesToRequest) {
                const inchargers = await RoleAssignment.findAll({
                    where: { venue_id: vid },
                    include: [{ model: Role, where: { user_role: { [Op.like]: '%INCHARGE%' } } }],
                    transaction: t
                });

                if (inchargers.length === 0) continue;

                // Get date/time context from the main task
                const currentTask = await Task.findByPk(taskId, { include: [TaskType], transaction: t });
                const taskType = currentTask?.TaskTypes?.[0];

                let targetTaskId = taskId;
                const needsSeparatePermission = payload.is_package || (vid !== payload.venue_id);

                if (needsSeparatePermission) {
                    const venueTask = await Task.create({
                        title: `Permission: ${title} at Venue`,
                        description: `Approval required for venue reservation.`,
                        category: 'Admin',
                        priority: 'high',
                        is_package: false,
                        parent_task_id: taskId,
                        venue_id: vid,
                        creator_id: userId,
                        status: 'Active',
                        stage: 'Active'
                    }, { transaction: t });

                    if (taskType) {
                        await TaskType.create({
                            task_id: venueTask.task_id,
                            task_name: 'Permission Request',
                            start_date: taskType.start_date,
                            end_date: taskType.end_date,
                            start_time: taskType.start_time,
                            end_time: taskType.end_time,
                            venue_id: vid,
                            recurrence: recurrence // Match parent recurrence
                        }, { transaction: t });
                    }

                    targetTaskId = venueTask.task_id;
                }

                for (const ra of inchargers) {
                    if (!ra.user_id) continue;
                    // Skip if already assigned in main loop (only for the main task)
                    if (!needsSeparatePermission && finalAssigneeIds.includes(ra.user_id * 1)) continue;

                    await TaskAssign.create({
                        task_id: targetTaskId,
                        user_id: ra.user_id,
                        status: 'pending'
                    }, { transaction: t });

                    await Notification.create({
                        user_id: ra.user_id,
                        title: 'Venue Booking Requires Your Approval',
                        msg: `A new booking "${title}" (Approved by higher authority) has been requested for your venue.`,
                        type: 'task_created'
                    }, { transaction: t });
                }
            }

            // --- NEW: Post-Approval Self-Log Logic ---
            if (payload.origin_type === 'self-log') {
                const taskTypeData = payload.task_type_data || {};
                const submittedTime = taskTypeData.start_date ? new Date(taskTypeData.start_date) : new Date();
                if (taskTypeData.start_time) {
                    const [h, m] = taskTypeData.start_time.split(':');
                    submittedTime.setHours(parseInt(h), parseInt(m), 0, 0);
                }

                await TaskAssign.upsert({
                    task_id: taskId,
                    user_id: userId,
                    status: 'completed',
                    accepted_at: submittedTime,
                    submitted_time: submittedTime,
                    earned_score: 0,
                    penalty_applied: 0
                }, { transaction: t });
            }
        }

        if (!transaction) await t.commit();

        // Notify Creator
        await Notification.create({
            user_id: userId,
            title: 'Task Approved',
            msg: `Your task "${title}" has been approved and activated.`,
            type: 'task_created'
        });

        return true;
    } catch (error) {
        if (!transaction) await t.rollback();
        throw error;
    }
};

// Core task creation logic exposed for internal replay
exports.createUnifiedTaskCore = async (payload, overrideCreatorId, overrideUserRole) => {
    return new Promise((resolve, reject) => {
        const fakeReq = {
            body: { ...payload, requires_approval: false },
            userId: overrideCreatorId,
            userRole: overrideUserRole || 'faculty', // Approvers trigger as the original creator's role
            file: null
        };
        const fakeRes = {
            status(code) { this._code = code; return this; },
            json(data) {
                if (this._code && this._code >= 400) {
                    reject(new Error(data.message || 'Task creation failed'));
                } else {
                    resolve(data);
                }
            }
        };
        exports.createUnifiedTask(fakeReq, fakeRes);
    });
};



// Update Task
exports.updateTask = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id, { include: [{ model: TaskType }] });
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Only creator or admin can update
        if (task.creator_id !== userId && userRole !== 'admin') {
            return res.status(403).json({ message: 'Only the creator or an admin can update this task' });
        }

        const payload = await normalizeTaskPayload(req.body);
        const {
            title, description, category, priority, is_package, venue_id,
            is_pause_allowed, score, penalty_per_hour, is_document, is_mandatory,
            is_approved, approver_id, requires_approval, resource_id, is_faculty, faculty_id,
            status, task_type_data,
            task_title_id // NEW: support for updating master title link
        } = payload;

        // If task_title_id is changing, we might want to update the title too
        let updateTitle = title || task.title;
        if (task_title_id && task_title_id !== task.task_title_id && !title) {
            const masterTitle = await TaskTitle.findByPk(task_title_id);
            if (masterTitle) updateTitle = masterTitle.task_title;
        }

        let finalFacultyId = faculty_id !== undefined ? faculty_id : task.faculty_id;
        if (is_faculty && finalFacultyId) {
            let facultyRecord = await Faculty.findByPk(finalFacultyId);
            if (!facultyRecord) {
                facultyRecord = await Faculty.findOne({ where: { user_id: finalFacultyId } });
            }
            if (facultyRecord) {
                finalFacultyId = facultyRecord.id;
            }
        }

        // Determine effective approval state
        // If requires_approval is being set to true → mark as pending approval
        // If being set to false → mark as active and approved
        let effectiveIsApproved = is_approved !== undefined ? is_approved : task.is_approved;
        let effectiveStatus = status || task.status;
        let effectiveApproverId = approver_id !== undefined ? approver_id : task.approver_id;

        if (requires_approval === true && !task.is_approved) {
            effectiveIsApproved = false;
            effectiveStatus = 'Pending Approval';
        } else if (requires_approval === false) {
            effectiveIsApproved = true;
            effectiveApproverId = null;
            if (effectiveStatus === 'Pending Approval') effectiveStatus = 'Active';
        }

        // Update basic task fields
        await task.update({
            title: updateTitle,
            description: description !== undefined ? description : task.description,
            category: category || task.category,
            priority: priority || task.priority,
            is_package: is_package !== undefined ? is_package : task.is_package,
            venue_id: venue_id !== undefined ? venue_id : task.venue_id,
            is_pause_allowed: is_pause_allowed !== undefined ? is_pause_allowed : task.is_pause_allowed,
            score: score !== undefined ? score : task.score,
            penalty_per_hour: penalty_per_hour !== undefined ? penalty_per_hour : task.penalty_per_hour,
            is_document: is_document !== undefined ? is_document : task.is_document,
            is_mandatory: is_mandatory !== undefined ? is_mandatory : task.is_mandatory,
            is_approved: effectiveIsApproved,
            approver_id: effectiveApproverId,
            resource_id: resource_id !== undefined ? resource_id : task.resource_id,
            is_faculty: is_faculty !== undefined ? is_faculty : task.is_faculty,
            faculty_id: finalFacultyId,
            status: effectiveStatus,
            task_title_id: task_title_id !== undefined ? task_title_id : task.task_title_id
        }, { transaction: t });

        // Update TaskType if provided
        if (task_type_data) {
            let typeData = task_type_data;
            if (typeof typeData === 'string') {
                try { typeData = JSON.parse(typeData); } catch (e) { /* use as is if fails */ }
            }

            const taskType = task.TaskTypes && task.TaskTypes[0];
            if (taskType) {
                const oldEndDate = taskType.end_date;
                const oldEndTime = taskType.end_time;

                // max_duration_hours is ONLY for package sub-tasks (tasks with a parent_task_id)
                // Never write it on standalone tasks to avoid confusing the escalation engine
                const isSubTask = !!task.parent_task_id;

                await taskType.update({
                    task_name: typeData.task_name || taskType.task_name,
                    start_date: typeData.start_date !== undefined ? typeData.start_date : taskType.start_date,
                    end_date: typeData.end_date !== undefined ? typeData.end_date : taskType.end_date,
                    start_time: typeData.start_time !== undefined ? typeData.start_time : taskType.start_time,
                    end_time: typeData.end_time !== undefined ? typeData.end_time : taskType.end_time,
                    time_quota_hours: typeData.time_quota_hours !== undefined ? typeData.time_quota_hours : taskType.time_quota_hours,
                    // Only update max_duration_hours for package sub-tasks
                    ...(isSubTask && typeData.max_duration_hours !== undefined
                        ? { max_duration_hours: typeData.max_duration_hours }
                        : {}),
                    venue_id: typeData.venue_id !== undefined ? typeData.venue_id : taskType.venue_id,
                    recurrence: typeData.recurrence || taskType.recurrence
                }, { transaction: t });

                // If end date/time extended, resolve any pending escalations
                const newEndDate = typeData.end_date || oldEndDate;
                const newEndTime = typeData.end_time || oldEndTime;

                if (newEndDate > oldEndDate || (newEndDate === oldEndDate && newEndTime > oldEndTime)) {
                    // Check if new deadline is in the future
                    const now = new Date();
                    const istOffset = 330 * 60 * 1000;
                    const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
                    const deadline = new Date(`${newEndDate}T${newEndTime || '23:59:59'}`);

                    if (deadline > localNow) {
                        await resolveTaskEscalations(id, userId, t);
                    }
                }
            }
        }

        // --- NEW: Synchronize Assignments ---
        if (payload.assignee_ids && Array.isArray(payload.assignee_ids)) {
            const newAssigneeIds = payload.assignee_ids.map(id => parseInt(id)).filter(id => !isNaN(id));

            // Get current assignments
            const currentAssignments = await TaskAssign.findAll({
                where: { task_id: id },
                transaction: t
            });

            const currentAssigneeIds = currentAssignments.map(a => a.user_id);

            // IDs to add
            const idsToAdd = newAssigneeIds.filter(uid => !currentAssigneeIds.includes(uid));
            // IDs to remove
            const idsToRemove = currentAssigneeIds.filter(uid => !newAssigneeIds.includes(uid));

            // Remove no longer assigned
            if (idsToRemove.length > 0) {
                await TaskAssign.destroy({
                    where: {
                        task_id: id,
                        user_id: idsToRemove
                    },
                    transaction: t
                });
            }

            // Add new assignments
            for (const uid of idsToAdd) {
                await TaskAssign.create({
                    task_id: id,
                    user_id: uid,
                    status: 'pending'
                }, { transaction: t });

                // Optional: Create notification for new assignee
                await Notification.create({
                    user_id: uid,
                    title: 'New Task Assigned (Updated)',
                    msg: `You have been added to the task "${updateTitle}".`,
                    type: 'task_created'
                }, { transaction: t });
            }
        }

        // --- NEW: Synchronize Closure Rules ---
        if (payload.closure_ids && Array.isArray(payload.closure_ids)) {
            // Remove existing closures for this task
            await TaskPackageClosure.destroy({
                where: { task_id: id },
                transaction: t
            });
            // Bulk create new ones
            const closures = payload.closure_ids.map(cid => ({
                task_id: id,
                closure_id: cid
            }));
            await TaskPackageClosure.bulkCreate(closures, { transaction: t });
        }

        await t.commit();
        res.json({ message: 'Task updated successfully' });

    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

// --- NEW: Get Task Details By ID ---
exports.getTaskDetailsById = async (req, res) => {
    try {
        const { id } = req.params;

        const task = await Task.findOne({
            where: { task_id: id, is_deleted: false },
            include: [
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name', 'reg_no'], required: false },
                        { model: Faculty, attributes: ['name', 'reg_no'], required: false },
                        { model: Staff, attributes: ['name'], required: false },
                        { model: RoleUser, attributes: ['name'], required: false }
                    ]
                },
                {
                    model: User,
                    as: 'Approver',
                    attributes: ['user_id', 'role'],
                    required: false,
                    include: [
                        { model: Student, attributes: ['name', 'reg_no'], required: false },
                        { model: Faculty, attributes: ['name', 'reg_no'], required: false },
                        { model: Staff, attributes: ['name'], required: false },
                        { model: RoleUser, attributes: ['name'], required: false }
                    ]
                },
                {
                    model: TaskType,
                    required: false
                },
                {
                    model: TaskAssign,
                    required: false,
                    attributes: ['id', 'user_id', 'status', 'created_at'],
                    include: [{
                        model: User,
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name', 'reg_no', 'department_id', 'year'], required: false },
                            { model: Faculty, attributes: ['name', 'reg_no', 'department_id'], required: false },
                            { model: Staff, attributes: ['name'], required: false },
                            { model: RoleUser, attributes: ['name'], required: false }
                        ]
                    }]
                },
                {
                    model: TaskPackageClosure,
                    required: false,
                    include: [{ model: TaskClosure, attributes: ['id', 'name'] }]
                } // Document links will be handled by existing document fields or separate tables if applicable
            ]
        });

        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found or has been deleted.' });
        }

        // Helper to format User names
        const formatUser = (u) => {
            if (!u) return null;
            const profile = u.Student || u.Faculty || u.Staff || u.RoleUser;
            return {
                user_id: u.user_id,
                name: profile ? profile.name : `User #${u.user_id}`,
                reg_no: profile?.reg_no || null,
                role: u.role
            };
        };

        const creator = formatUser(task.Creator);
        const approver = formatUser(task.Approver);

        // Format Assignees
        const assignees = task.TaskAssigns ? task.TaskAssigns.map(ta => ({
            assignment_id: ta.id, // TaskAssign primary key is `id`
            status: ta.status,
            assigned_at: ta.created_at,
            user: formatUser(ta.User)
        })) : [];

        // Format Closures
        const closures = task.TaskPackageClosures ? task.TaskPackageClosures.map(tc => ({
            closure_id: tc.TaskClosure?.id,
            closure_name: tc.TaskClosure?.name
        })) : [];

        // Compile full details
        const taskDetails = {
            task_id: task.task_id,
            title: task.title,
            description: task.description,
            category: task.category,
            origin_type: task.origin_type,
            priority: task.priority,
            mandatory_task: task.mandatory_task,
            is_package: task.is_package,
            score: task.score,
            penalty: task.penalty,
            status: task.status,
            proof_attachment: task.proof_attachment,
            rejection_reason: task.rejection_reason,
            is_approved: task.is_approved,
            created_at: task.created_at,

            creator: creator,
            approver: approver,

            // Timing and Location (From TaskType)
            type_details: task.TaskTypes && task.TaskTypes.length > 0 ? {
                task_name: task.TaskTypes[0].task_name,
                start_date: task.TaskTypes[0].start_date,
                end_date: task.TaskTypes[0].end_date,
                start_time: task.TaskTypes[0].start_time,
                end_time: task.TaskTypes[0].end_time,
                recurrence: task.TaskTypes[0].recurrence,
                time_quota_hours: task.TaskTypes[0].time_quota_hours,
                venue_id: task.TaskTypes[0].venue_id,
                pause_allowed: task.TaskTypes[0].pause_allowed,
            } : null,

            assignees: assignees,
            closures: closures
        };

        res.json({
            success: true,
            task: taskDetails
        });

    } catch (error) {
        console.error("GET TASK DETAILS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * NEW: Get very lightweight status summary of a task
 * GET /api/tasks/:id/status
 */
exports.getTaskStatusSummary = async (req, res) => {
    try {
        const { id } = req.params;

        const task = await Task.findOne({
            where: { task_id: id, is_deleted: false },
            attributes: ['task_id', 'title', 'stage', 'status', 'creator_id', 'is_pause_allowed', 'is_otp_required', 'closure_ids', 'is_faculty', 'faculty_id', 'approver_id', 'is_approved', 'is_escalate'],
            include: [
                { model: TaskType },
                { model: TaskAssign },
                { model: TaskEscalation }
            ]
        });

        if (!task) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }

        const button = getTaskButtonState(task, req.userId, req.userRole);

        res.json({
            success: true,
            task_name: task.title,
            stage: task.stage,
            status: task.status,
            action_button: button
        });

    } catch (error) {
        console.error("GET TASK STATUS ERROR:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Task (Soft Delete)
exports.deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const task = await Task.findByPk(id);
        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Only creator or admin can delete
        if (task.creator_id !== userId && userRole !== 'admin') {
            return res.status(403).json({ message: 'Only the creator or an admin can delete this task' });
        }

        await task.update({ is_deleted: true, status: 'Inactive' });
        res.json({ message: 'Task deleted successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get User Task Stats (Total Score, Penalty, 7-Day Breakdown)
exports.getUserTaskStats = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;
        const { TaskPackageClosure, TaskClosure, TaskOTP } = require('../models');

        const now = new Date();
        const firstDay = new Date(now);
        firstDay.setDate(now.getDate() - 6);
        firstDay.setHours(0, 0, 0, 0);

        // Discovery-based profile fetch
        let profile = await Student.findOne({ where: { user_id: userId } }) ||
                      await Faculty.findOne({ where: { user_id: userId } }) ||
                      await Staff.findOne({ where: { user_id: userId } }) ||
                      await RoleUser.findOne({ where: { user_id: userId } });

        const profileNetScore = profile ? parseFloat(profile.score || 0) : 0;
        const profileTotalPenalty = profile ? parseFloat(profile.penalty || 0) : 0;
        const profileTotalScore = profileNetScore + profileTotalPenalty; // Gross = Net + Penalty

        // Fetch all assignments for the user
        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    { model: TaskType },
                    {
                        model: TaskPackageClosure,
                        required: false,
                        include: [{ model: TaskClosure, attributes: ['name'] }]
                    },
                    { model: TaskOTP, required: false }
                ]
            }],
            order: [['submitted_time', 'DESC']]
        });

        // Initialize last 7 days with 0
        const dailyStats = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(firstDay);
            d.setDate(firstDay.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            dailyStats[dateStr] = 0;
        }

        let tasksBaseSum = 0;
        let tasksEarnedSum = 0;
        let tasksPenaltySum = 0;
        const taskDetails = [];

        for (const a of assignments) {
            if (!a.Task || a.status !== 'completed') continue;

            const task = a.Task;
            const closures = task.TaskPackageClosures || [];

            const baseScore = parseFloat(task.score || 0);
            const earnedScore = parseFloat(a.earned_score || 0);
            const penalty = parseFloat(a.penalty_applied || 0);

            tasksBaseSum += baseScore;
            tasksEarnedSum += earnedScore;
            tasksPenaltySum += penalty;

            if (a.submitted_time) {
                const d = new Date(a.submitted_time);
                if (!isNaN(d.getTime())) {
                    const submittedDate = d.toISOString().split('T')[0];
                    if (dailyStats.hasOwnProperty(submittedDate)) {
                        dailyStats[submittedDate] += earnedScore;
                    }
                }
            }

            if (baseScore > 0 || penalty > 0) {
                taskDetails.push({
                    task_id: a.task_id,
                    title: task.title,
                    status: a.status,
                    base_score: baseScore,
                    earned_score: earnedScore,
                    penalty_applied: penalty,
                    submitted_time: a.submitted_time,
                    proof: a.proof || null,
                    required_closures: closures.map(c => c.TaskClosure?.name).filter(Boolean),
                    submission_type: penalty > 0 ? 'Late Submission' : 'Perfect Submission'
                });
            }
        }

        // --- NEW: SCORE SYNCHRONIZATION ---
        // Using the centralized utility to sync and get correct totals
        const { adjustLongTaskStatus, cleanupStudentTasks, syncUserScore } = require('../utils/task-utils');
        await syncUserScore(userId, userRole);

        // We re-sum from taskDetails if we want to be absolutely sure, but syncUserScore already updated the DB.
        // For the response, we'll use the freshly calculated sums from the loop.
        const finalTotalScore = tasksEarnedSum + tasksPenaltySum;
        const finalEarnedScore = tasksEarnedSum;
        const finalTotalPenalty = tasksPenaltySum;

        const last7Days = Object.keys(dailyStats).map(date => ({
            date,
            score: dailyStats[date]
        }));

        res.json({
            total_score: finalTotalScore,
            total_penalty: finalTotalPenalty,
            earned_score: finalEarnedScore,
            last_7_days: last7Days,
            task_details: taskDetails
        });

    } catch (error) {
        console.error("Critical error in getUserTaskStats:", error);
        res.status(500).json({ message: error.message });
    }
};


// Comprehensive Student Dashboard API
exports.getStudentDashboard = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        // 1. Setup Date logic (IST)
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const today = new Date(localNow);
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Helper: safe local date string
        const toLocalISO = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const todayStr = toLocalISO(today);

        // 2. Fetch Student Profile
        const student = await Student.findOne({
            where: { user_id: userId },
            include: [{ model: Department, attributes: ['name'] }]
        });

        if (!student) {
            return res.status(404).json({ message: 'Student profile not found' });
        }

        // 3. Fetch Task Statistics
        const allAssignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                required: true,
                include: [
                    { model: TaskType },
                    { model: Task, as: 'Parent', attributes: ['task_id', 'title'] }
                ]
            }]
        });

        const stats = {
            total_tasks: allAssignments.length,
            pending_tasks: allAssignments.filter(a => a.status === 'pending').length,
            overdue_tasks: allAssignments.filter(a => {
                const tt = a.Task?.TaskTypes?.[0];
                if (!tt) return false;
                const datePart = toLocalISO(tt.end_date);
                const endTime = new Date(`${datePart}T${tt.end_time}`);
                return (a.status === 'pending' || a.status === 'accepted') &&
                    endTime < localNow &&
                    (!a.proof || a.proof === '');
            }).length
        };

        // 4. Today's Scheduled Tasks (Exclude Rejected)
        const todayScheduleRaw = allAssignments.filter(a => {
            const tt = a.Task?.TaskTypes?.[0];
            return tt && toLocalISO(tt.start_date) === todayStr && a.status !== 'rejected';
        }).map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            description: a.Task.description,
            status: a.status,
            time: a.Task.TaskTypes[0].start_time + ' - ' + a.Task.TaskTypes[0].end_time,
            category: a.Task.category,
            priority: a.Task.priority,
            parent_task_id: a.Task.parent_task_id,
            sub_tasks: []
        }));

        // 5. Tomorrow's Activity (Pending Only - Exclude Rejected)
        const tomorrowStr = toLocalISO(tomorrow);
        const tomorrowActivityRaw = allAssignments.filter(a => {
            const tt = a.Task?.TaskTypes?.[0];
            return tt && toLocalISO(tt.start_date) === tomorrowStr && a.status === 'pending';
        }).map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            status: a.status,
            time: a.Task.TaskTypes[0].start_time + ' - ' + a.Task.TaskTypes[0].end_time,
            parent_task_id: a.Task.parent_task_id,
            sub_tasks: []
        }));

        // 6. Pending Proof Submission (Accepted/In Progress Only)
        const pendingProofRaw = allAssignments.filter(a => {
            const task = a.Task;
            const tt = task?.TaskTypes?.[0];
            if (!task || !tt || !task.is_document) return false;

            const datePart = toLocalISO(tt.start_date);
            const startTime = new Date(`${datePart}T${tt.start_time}`);
            return (a.status === 'in_progress') &&
                startTime <= localNow &&
                (!a.proof || a.proof === '');
        }).map(a => ({
            task_id: a.Task.task_id,
            title: a.Task.title,
            deadline: a.Task.TaskTypes[0].end_time,
            status: a.status,
            parent_task_id: a.Task.parent_task_id,
            sub_tasks: []
        }));

        // Helper: Nesting for Dashboard
        const buildDashboardTree = (flatTasks) => {
            const taskMap = {};
            const rootTasks = [];
            flatTasks.forEach(t => { taskMap[t.task_id] = t; });
            flatTasks.forEach(t => {
                if (t.parent_task_id && taskMap[t.parent_task_id]) {
                    taskMap[t.parent_task_id].sub_tasks.push(t);
                } else {
                    rootTasks.push(t);
                }
            });
            return rootTasks;
        };

        const todaySchedule = buildDashboardTree(todayScheduleRaw);
        const tomorrowActivity = buildDashboardTree(tomorrowActivityRaw);
        const pendingProof = buildDashboardTree(pendingProofRaw);

        res.json({
            success: true,
            profile: {
                name: student.name,
                email: student.email,
                reg_no: student.reg_no,
                department: student.Department?.name,
                cgpa: student.c_gpa,
                score: student.score,
                penalty: student.penalty,
                total_score: student.total_score
            },
            stats,
            today_schedule: todaySchedule,
            tomorrow_activity: tomorrowActivity,
            pending_proof: pendingProof
        });

    } catch (error) {
        console.error(`[StudentDashboard] Error: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};

// 1. Get Pending Proof Tasks (Accepted + Document Required + No Proof)
exports.getPendingProofTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const { limit, offset } = getPagination(req.query);
        const { Op } = require('sequelize');

        // Setup Local Date logic (IST)
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const tasksInfo = await TaskAssign.findAndCountAll({
            where: {
                user_id: userId,
                status: { [Op.in]: ['in_progress', 'accepted'] }, // Include accepted for floating/long
                [Op.or]: [
                    { proof: null },
                    { proof: '' }
                ]
            },
            include: [{
                model: Task,
                where: {
                    is_deleted: false,
                    is_document: true
                },
                include: [{
                    model: TaskType,
                    required: true
                }, {
                    model: Venue,
                    required: false
                }]
            }],
            limit,
            offset,
            order: [[Task, TaskType, 'start_date', 'ASC'], [Task, TaskType, 'start_time', 'ASC']]
        });

        // Helper for date masking
        const toLocalISO = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Filter: 
        // 1. Regular tasks: status must be 'in_progress' and current time >= start time.
        // 2. Background tasks (Floating/Long): Status can be 'accepted' or 'in_progress'.
        const filteredTasks = tasksInfo.rows.filter(a => {
            const tt = a.Task.TaskTypes && a.Task.TaskTypes[0];
            if (!tt) return false;

            const isBackgroundTask = tt.task_name === 'Floating Task' || tt.task_name === 'Long Task' || tt.task_name === 'Date-Only / Long Task';

            // Background tasks show immediately once accepted/started
            if (isBackgroundTask) return true;

            // Regular tasks logic:
            if (a.status !== 'in_progress') return false;

            const datePart = toLocalISO(tt.start_date);
            const startDateTime = new Date(`${datePart}T${tt.start_time}`);

            // Must have started
            if (startDateTime > localNow) return false;

            // Non-students have a 6-hour working-hour deadline for regular tasks
            if (req.userRole !== 'student') {
                const endDatePart = toLocalISO(tt.end_date || tt.start_date);
                const endDateTime = new Date(`${endDatePart}T${tt.end_time || '16:30:00'}`);

                if (localNow > endDateTime) {
                    const elapsedWorkingMins = getWorkingMinutes(endDateTime, localNow);
                    if (elapsedWorkingMins > 360) return false; // Hide if past 6 working hours
                }
            }

            return true;
        });

        const formatted = filteredTasks.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            description: a.Task.description,
            is_document: a.Task.is_document,
            status: a.status,
            proof_status: 'Not Submitted',
            timing: {
                start_date: a.Task.TaskTypes[0].start_date,
                start_time: a.Task.TaskTypes[0].start_time,
                end_date: a.Task.TaskTypes[0].end_date,
                end_time: a.Task.TaskTypes[0].end_time
            }
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error in getPendingProofTasks:', error);
        res.status(500).json({ message: error.message });
    }
};

// 1.5. Get Verification Tasks (For Managers to review other's submissions)
exports.getVerificationTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');
        const { Task, TaskAssign, User, Student, Faculty, Staff, RoleUser } = require('../models');

        // Assignments where status is 'completed' AND proof exists
        // Filter by tasks where current user is creator or assigned faculty
        const assignments = await TaskAssign.findAll({
            where: {
                status: 'completed',
                proof: { [Op.not]: null }
            },
            include: [
                {
                    model: Task,
                    where: {
                        [Op.or]: [
                            { creator_id: userId },
                            { faculty_id: userId }
                        ]
                    },
                    attributes: ['task_id', 'title', 'description', 'is_document']
                },
                {
                    model: User,
                    attributes: ['user_id', 'role'],
                    include: [
                        { model: Student, attributes: ['name'], required: false },
                        { model: Faculty, attributes: ['name'], required: false },
                        { model: Staff, attributes: ['name'], required: false },
                        { model: RoleUser, attributes: ['name'], required: false }
                    ]
                }
            ],
            order: [['submitted_time', 'DESC']]
        });

        const formatted = assignments.map(a => {
            const userDetails = a.User?.Student || a.User?.Faculty || a.User?.Staff || a.User?.RoleUser;
            return {
                assignment_id: a.id,
                task_id: a.Task.task_id,
                title: a.Task.title,
                description: a.Task.description,
                assignee_name: userDetails?.name || 'Unknown',
                assignee_role: a.User?.role || 'Unknown',
                submitted_time: a.submitted_time,
                proof: a.proof,
                status: a.status
            };
        });

        res.json(formatted);
    } catch (error) {
        console.error('Error in getVerificationTasks:', error);
        res.status(500).json({ message: error.message });
    }
};

// 2. Get Tasks Assigned Today
exports.getTasksAssignedToday = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const tasks = await TaskAssign.findAll({
            where: {
                user_id: userId,
                created_at: {
                    [Op.gte]: today,
                    [Op.lt]: tomorrow
                }
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }, { model: Venue }]
            }]
        });

        const formatted = tasks.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            status: a.status,
            assigned_at: a.created_at,
            is_approved: a.Task.is_approved
        }));

        res.json({
            date: today.toISOString().split('T')[0],
            count: formatted.length,
            tasks: formatted
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2b. Get Tasks Scheduled for Today by User ID (Improved)
exports.getTasksAssignedTodayByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const { Op } = require('sequelize');

        const now = new Date();
        const todayStr = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0];

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [
                    {
                        model: TaskType,
                        where: {
                            [Op.and]: [
                                { start_date: { [Op.lte]: `${todayStr} 23:59:59` } },
                                {
                                    [Op.or]: [
                                        { end_date: { [Op.gte]: `${todayStr} 00:00:00` } },
                                        { end_date: null }
                                    ]
                                }
                            ]
                        }
                    },
                    { model: Venue }
                ]
            }]
        });

        const todayTasks = [];
        assignments.forEach(a => {
            const task = a.Task;
            const taskType = task.TaskTypes[0];
            if (isOccurrence(todayStr, taskType.start_date, taskType.end_date, taskType.recurrence)) {
                todayTasks.push({
                    assignment_id: a.id,
                    task_id: task.task_id,
                    title: task.title,
                    status: a.status,
                    priority: task.priority,
                    category: task.category,
                    timing: {
                        start_time: taskType.start_time,
                        end_time: taskType.end_time
                    }
                });
            }
        });

        res.json({
            user_id: userId,
            date: todayStr,
            count: todayTasks.length,
            tasks: todayTasks
        });
    } catch (error) {
        console.error('Error in getTasksAssignedTodayByUserId:', error);
        res.status(500).json({ message: error.message });
    }
};

// Delete Task Assignment (Soft Delete)
exports.deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const assignment = await TaskAssign.findByPk(id, {
            include: [{ model: Task }]
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Only admin or creator of the task can delete the assignment
        if (userRole !== 'admin' && assignment.Task.creator_id !== userId) {
            return res.status(403).json({ message: 'Only an admin or the task creator can delete this assignment' });
        }

        await assignment.destroy(); // Soft delete due to paranoid: true in model

        await TaskLog.create({
            task_id: assignment.task_id,
            user_id: userId,
            action: 'delete_assignment',
            details: `Assignment ID ${id} (User ID ${assignment.user_id}) deleted by ${userRole}`
        });

        res.json({ message: 'Task assignment deleted successfully' });

    } catch (error) {
        console.error('Error in deleteAssignment:', error);
        res.status(500).json({ message: error.message });
    }
};

// 3. Get Approved Upcoming Tasks
exports.getApprovedUpcomingTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();

        // Fetch accepted assignments
        const assignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: 'accepted'
            },
            include: [{
                model: Task,
                where: { is_deleted: false },
                include: [{ model: TaskType }, { model: Venue }]
            }]
        });

        // Filter for Future Start
        const upcoming = assignments.filter(a => {
            const taskType = a.Task.TaskTypes && a.Task.TaskTypes[0];
            if (!taskType) return false;

            let startDateTime = null;
            if (taskType.task_name === 'Fixed Time Task' || taskType.task_name === 'Meeting') {
                if (taskType.start_date && taskType.start_time) {
                    const dateStr = new Date(taskType.start_date).toISOString().split('T')[0];
                    startDateTime = new Date(`${dateStr}T${taskType.start_time}`);
                } else if (taskType.start_date) {
                    startDateTime = new Date(taskType.start_date);
                }
            } else if (taskType.start_date) {
                startDateTime = new Date(taskType.start_date);
            }

            return startDateTime && startDateTime > now;
        });

        const formatted = upcoming.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            start_date: a.Task.TaskTypes[0]?.start_date,
            start_time: a.Task.TaskTypes[0]?.start_time,
            status: a.status
        }));

        // Manual pagination
        const paginated = formatted.slice(offset, offset + limit);

        res.json(getPagingData({ count: formatted.length, rows: paginated }, page, limit));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 4. Get Pending Upcoming Tasks (Unapproved & Future Start)
exports.getPendingUpcomingTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();

        // 1. Fetch pending assignments
        const assignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: 'pending'
            },
            include: [{
                model: Task,
                where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
                include: [{ model: TaskType }, { model: Venue }]
            }]
        });

        // 2. Filter for Future Start Date/Time
        const upcoming = assignments.filter(a => {
            const taskType = a.Task.TaskTypes && a.Task.TaskTypes[0];
            if (!taskType) return false;

            let startDateTime = null;
            if (taskType.task_name === 'Fixed Time Task' || taskType.task_name === 'Meeting') {
                if (taskType.start_date && taskType.start_time) {
                    const dateStr = new Date(taskType.start_date).toISOString().split('T')[0];
                    startDateTime = new Date(`${dateStr}T${taskType.start_time}`);
                } else if (taskType.start_date) {
                    startDateTime = new Date(taskType.start_date);
                }
            } else if (taskType.start_date) {
                startDateTime = new Date(taskType.start_date);
            }

            return startDateTime && startDateTime > now;
        });

        const formatted = upcoming.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            start_date: a.Task.TaskTypes[0]?.start_date,
            start_time: a.Task.TaskTypes[0]?.start_time,
            status: a.status
        }));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 5. Get Monthly Schedule (Comprehensive: Specific Date or Range)
exports.getMonthlySchedule = async (req, res) => {
    try {
        const userId = req.userId;
        const { date, venue_id } = req.query;
        const { Op, literal } = require('sequelize');
        const { Venue, Resource, User, AuthAccount, Student, Faculty, Staff, RoleUser, TaskType } = require('../models');

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            if (!d) return null;
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let startDate, endDate;
        if (date) {
            startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);
            if (isNaN(startDate.getTime())) return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
        } else {
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 15);
            endDate = new Date(today);
            endDate.setDate(today.getDate() + 7);
            endDate.setHours(23, 59, 59, 999);
        }

        const startDateStr = getLocalDateString(startDate);
        const endDateStr = getLocalDateString(endDate);

        const taskWhere = { is_deleted: false };
        const assignWhere = { 
            status: { [Op.in]: ['accepted', 'completed', 'pending'] } 
        };

        if (venue_id) {
            // Venue Calendar View: Show ALL assignments for this venue
            taskWhere[Op.or] = [
                { venue_id: venue_id },
                literal(`\`Task\`.\`task_id\` IN (SELECT task_id FROM task_types WHERE venue_id = ${parseInt(venue_id)})`)
            ];
            // Note: We deliberately do NOT filter by user_id here so the venue schedule is complete
        } else {
            // Personal Calendar View: Show only the logged-in user's assignments
            assignWhere.user_id = userId;
            // Removed restrictive Op.not that was hiding venue tasks from students' personal calendars
        }

        const assignments = await TaskAssign.findAll({
            where: assignWhere,
            include: [{
                model: Task,
                where: taskWhere,
                include: [
                    {
                        model: TaskType,
                        required: true,
                        where: {
                            [Op.and]: [
                                { start_date: { [Op.lte]: `${endDateStr} 23:59:59` } },
                                {
                                    [Op.or]: [
                                        { end_date: { [Op.gte]: `${startDateStr} 00:00:00` } },
                                        { end_date: null }
                                    ]
                                }
                            ]
                        }
                    },
                    { model: Venue, attributes: ['name', 'location'], required: false },
                    { model: Resource, attributes: ['name'], required: false },
                    {
                        model: User,
                        as: 'Creator',
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: AuthAccount, attributes: ['email'], required: false },
                            { model: Student, attributes: ['name'], required: false },
                            { model: Faculty, attributes: ['name'], required: false },
                            { model: Staff, attributes: ['name'], required: false },
                            { model: RoleUser, attributes: ['name'], required: false }
                        ]
                    }
                ]
            }]
        });

        const schedule = {};

        const isOccurrence = (targetDateStr, tStart, tEnd, recurrence) => {
            const startStr = getLocalDateString(tStart);
            const endStr = tEnd ? getLocalDateString(tEnd) : null;

            if (targetDateStr < startStr) return false;
            if (endStr && targetDateStr > endStr) return false;

            if (recurrence === 'none') return targetDateStr === startStr;
            if (recurrence === 'daily') return true;

            const targetDate = new Date(`${targetDateStr}T00:00:00`);
            const startDate = new Date(`${startStr}T00:00:00`);

            if (recurrence === 'weekly') return targetDate.getDay() === startDate.getDay();
            if (recurrence === 'monthly') return targetDate.getDate() === startDate.getDate();
            return false;
        };

        assignments.forEach(a => {
            const task = a.Task;
            const creator = task.Creator;
            const creatorDetails = creator?.Student || creator?.Faculty || creator?.Staff || creator?.RoleUser;

            let creatorName = creatorDetails?.name;
            if (!creatorName && creator?.role?.toLowerCase() === 'admin') creatorName = 'Administrator';

            task.TaskTypes.forEach(taskType => {
                let current = new Date(startDate);
                // Important: reset current to local midnight for iteration
                current.setHours(0, 0, 0, 0);

                while (current <= endDate) {
                    const currentStr = getLocalDateString(current);
                    if (isOccurrence(currentStr, taskType.start_date, taskType.end_date, taskType.recurrence)) {
                        if (!schedule[currentStr]) schedule[currentStr] = [];

                        schedule[currentStr].push({
                            assignment_id: a.id,
                            task_id: task.task_id,
                            title: task.title,
                            description: task.description,
                            category: task.category,
                            priority: task.priority,
                            status: a.status,
                            score: parseFloat(task.score || 0),
                            penalty: parseFloat(task.penalty_per_hour || 0),
                            flags: {
                                is_package: task.is_package,
                                is_mandatory: task.is_mandatory,
                                is_document: task.is_document,
                                is_approved: task.is_approved
                            },
                            timing: {
                                start_time: taskType.start_time,
                                end_time: taskType.end_time,
                                recurrence: taskType.recurrence,
                                task_name: taskType.task_name
                            },
                            location: task.Venue ? { name: task.Venue.name, location: task.Venue.location } : null,
                            resource: task.Resource ? { name: task.Resource.name } : null,
                            creator: {
                                name: creatorName || 'Unknown',
                                email: creatorDetails?.email || creator?.AuthAccount?.email || 'N/A'
                            }
                        });
                    }
                    current.setDate(current.getDate() + 1);
                }
            });
        });

        // ─── NEW: Calendar Segmentation Logic ───
        // Segments "Long Tasks" around "Fixed Tasks" within working hours (08:45 - 16:30)
        const WORK_START = "08:45:00";
        const WORK_END = "16:30:00";

        Object.keys(schedule).forEach(dKey => {
            const dayTasks = schedule[dKey];
            
            // 1. Separate into Fixed (timed) and Long (untimed or explicit long)
            const fixedTasks = dayTasks.filter(t => t.timing.start_time && t.timing.end_time);
            const longTasks = dayTasks.filter(t => !t.timing.start_time || ['Long Task', 'Date-Only / Long Task'].includes(t.timing.task_name));

            // 2. Sort fixed tasks by start time
            fixedTasks.sort((a, b) => (a.timing.start_time || "").localeCompare(b.timing.start_time || ""));

            // 3. Basic overlap removal/cleanup for fixed tasks
            const cleanedFixed = [];
            let lastFEnd = null;
            for (const ft of fixedTasks) {
                if (!lastFEnd || ft.timing.start_time >= lastFEnd) {
                    cleanedFixed.push(ft);
                    lastFEnd = ft.timing.end_time;
                }
            }

            // 4. Segmentation if Long Task exists
            if (longTasks.length > 0) {
                const baseLong = longTasks[0]; // Use the primary long task for filling
                const finalTasks = [];
                let currentTime = WORK_START;

                for (const ft of cleanedFixed) {
                    // Segment before or between fixed tasks
                    if (ft.timing.start_time > currentTime) {
                        finalTasks.push({
                            ...baseLong,
                            title: baseLong.title,
                            timing: {
                                ...baseLong.timing,
                                start_time: currentTime,
                                end_time: ft.timing.start_time
                            }
                        });
                    }
                    
                    // Add the fixed task itself as a segment
                    finalTasks.push({
                        ...ft,
                        title: ft.title
                    });
                    
                    // Move current time to end of this fixed task
                    currentTime = ft.timing.end_time > currentTime ? ft.timing.end_time : currentTime;
                }

                // Final gap segment after all fixed tasks until end of workday
                if (currentTime < WORK_END) {
                    finalTasks.push({
                        ...baseLong,
                        title: baseLong.title,
                        timing: {
                            ...baseLong.timing,
                            start_time: currentTime,
                            end_time: WORK_END
                        }
                    });
                }
                schedule[dKey] = finalTasks;
            } else {
                schedule[dKey] = cleanedFixed;
            }
        });

        if (date) {
            res.json({
                date,
                count: (schedule[date] || []).length,
                tasks: schedule[date] || []
            });
        } else {
            res.json({
                mode: 'Range',
                range: { start: startDateStr, end: endDateStr },
                schedule
            });
        }
    } catch (error) {
        console.error('Error in getMonthlySchedule:', error);
        res.status(500).json({ message: error.message });
    }
};


// 6. Get Task Detail by ID (Comprehensive - All Details)
exports.getTaskDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.userId;
        const userRole = req.userRole;

        const { Resource, Venue } = require('../models');

        const task = await Task.findByPk(id, {
            include: [
                {
                    model: TaskType,
                    attributes: ['id', 'task_name', 'start_date', 'end_date', 'start_time', 'end_time', 'time_quota_hours', 'venue_id', 'recurrence']
                },
                {
                    model: Venue,
                    attributes: ['venue_id', 'name', 'venue_type', 'location', 'description', 'image_url'],
                    required: false
                },
                {
                    model: Resource,
                    attributes: ['resource_id', 'name', 'description'],
                    required: false
                },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['user_id', 'role'],
                    required: false,
                    include: [
                        { model: Student, attributes: ['name', 'email'], required: false },
                        { model: Faculty, attributes: ['name', 'email'], required: false },
                        { model: Staff, attributes: ['name', 'email'], required: false },
                        { model: RoleUser, attributes: ['name', 'email'], required: false },
                        { model: AuthAccount, attributes: ['email'], required: false }
                    ]
                },
                {
                    model: User,
                    as: 'Approver',
                    attributes: ['user_id', 'role'],
                    required: false,
                    include: [
                        { model: Student, attributes: ['name', 'email'], required: false },
                        { model: Faculty, attributes: ['name', 'email'], required: false },
                        { model: Staff, attributes: ['name', 'email'], required: false },
                        { model: RoleUser, attributes: ['name', 'email'], required: false },
                        { model: AuthAccount, attributes: ['email'], required: false }
                    ]
                },
                {
                    model: Faculty,
                    attributes: ['user_id', 'name', 'email', 'department_id'],
                    required: false
                },
                {
                    model: TaskAssign,
                    required: false,
                    include: [
                        {
                            model: User,
                            attributes: ['user_id', 'role'],
                            required: false,
                            include: [
                                { model: Student, attributes: ['name', 'email', 'department_id', 'year'], required: false },
                                { model: Faculty, attributes: ['name', 'email', 'department_id'], required: false },
                                { model: Staff, attributes: ['name', 'email'], required: false },
                                { model: RoleUser, attributes: ['name', 'email'], required: false },
                                { model: AuthAccount, attributes: ['email'], required: false }
                            ]
                        }
                    ]
                },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskTitle,
                    required: false
                },
                {
                    model: Task,
                    as: 'Children',
                    include: [
                        { model: TaskType },
                        {
                            model: TaskAssign,
                            include: [
                                {
                                    model: User,
                                    attributes: ['user_id', 'role'],
                                    include: [
                                        { model: Student, attributes: ['name', 'email'], required: false },
                                        { model: Faculty, attributes: ['name', 'email'], required: false },
                                        { model: Staff, attributes: ['name', 'email'], required: false },
                                        { model: RoleUser, attributes: ['name', 'email'], required: false }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check if user has permission to view this task
        // Allow: admin, task creator, any assignee, task approver, faculty/staff/HOD (non-student roles)
        const nonStudentRoles = ['admin', 'faculty', 'staff', 'role-user'];
        const canView =
            userRole === 'admin' ||
            nonStudentRoles.includes(userRole?.toLowerCase()) ||
            String(task.creator_id) === String(userId) ||
            String(task.approver_id) === String(userId) ||
            task.TaskAssigns?.some(a => String(a.user_id) === String(userId));
        if (!canView) {
            return res.status(403).json({ message: 'You do not have permission to view this task' });
        }

        // Format creator info
        let creatorInfo = null;
        if (task.Creator) {
            const creatorDetails = task.Creator.Student || task.Creator.Faculty ||
                task.Creator.Staff || task.Creator.RoleUser;

            let name = creatorDetails?.name;
            const email = creatorDetails?.email || task.Creator.AuthAccount?.email;

            if (!name) {
                if (task.Creator.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            creatorInfo = {
                user_id: task.Creator.user_id,
                role: task.Creator.role,
                name: name,
                email: email || 'Unknown'
            };
        }

        // Format approver info
        let approverInfo = null;
        if (task.Approver) {
            const approverDetails = task.Approver.Student || task.Approver.Faculty ||
                task.Approver.Staff || task.Approver.RoleUser;

            let name = approverDetails?.name;
            const email = approverDetails?.email || task.Approver.AuthAccount?.email;

            if (!name) {
                if (task.Approver.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            approverInfo = {
                user_id: task.Approver.user_id,
                role: task.Approver.role,
                name: name,
                email: email || 'Unknown'
            };
        }

        // Format faculty info (if task is faculty-specific)
        let facultyInfo = null;
        if (task.Faculty) {
            facultyInfo = {
                user_id: task.Faculty.user_id,
                name: task.Faculty.name,
                email: task.Faculty.email,
                department_id: task.Faculty.department_id
            };
        }

        // Format assignees
        const assignees = task.TaskAssigns?.map(assign => {
            const userDetails = assign.User?.Student || assign.User?.Faculty ||
                assign.User?.Staff || assign.User?.RoleUser;

            let name = userDetails?.name;
            const email = userDetails?.email || assign.User?.AuthAccount?.email;

            if (!name) {
                if (assign.User?.role?.toLowerCase() === 'admin') {
                    name = 'Administrator';
                } else {
                    name = 'Unknown User';
                }
            }

            return {
                assignment_id: assign.id,
                user_id: assign.user_id,
                role: assign.User?.role || 'Unknown',
                name: name,
                email: email || 'Unknown',
                department_id: userDetails?.department_id || null,
                year: userDetails?.year || null,
                status: assign.status,
                accepted_at: assign.accepted_at,
                completed_at: assign.completed_at,
                submitted_time: assign.submitted_time,
                proof: assign.proof,
                earned_score: parseFloat(assign.earned_score || 0),
                penalty_applied: parseFloat(assign.penalty_applied || 0),
                is_pause_approved: assign.is_pause_approved,
                pause_start: assign.pause_start,
                pause_end: assign.pause_end
            };
        }) || [];

        // Calculate statistics
        const totalAssignees = assignees.length;
        const acceptedCount = assignees.filter(a => a.status === 'accepted').length;
        const completedCount = assignees.filter(a => a.status === 'completed').length;
        const pendingCount = assignees.filter(a => a.status === 'pending').length;
        const rejectedCount = assignees.filter(a => a.status === 'rejected').length;

        // Task response
        const response = {
            task_id: task.task_id,
            task_title_id: task.task_title_id, // NEW
            title: task.title,
            master_title: task.TaskTitle ? {
                id: task.TaskTitle.id,
                title: task.TaskTitle.task_title
            } : null,
            description: task.description,
            category: task.category,
            priority: task.priority,
            status: task.status,

            // Scores and Penalties
            score: parseFloat(task.score || 0),
            penalty_per_hour: parseFloat(task.penalty_per_hour || 0),

            // Flags
            is_package: task.is_package,
            is_pause_allowed: task.is_pause_allowed,
            is_document: task.is_document,
            is_mandatory: task.is_mandatory,
            is_approved: task.is_approved,
            is_faculty: task.is_faculty,
            is_deleted: task.is_deleted,
            is_escalate: task.is_escalate,

            // Related IDs
            venue_id: task.venue_id,
            resource_id: task.resource_id,
            creator_id: task.creator_id,
            approver_id: task.approver_id,
            faculty_id: task.faculty_id,

            // Related Details
            creator: creatorInfo,
            approver: approverInfo,
            faculty: facultyInfo,
            venue: task.Venue ? {
                venue_id: task.Venue.venue_id,
                name: task.Venue.name,
                venue_type: task.Venue.venue_type,
                location: task.Venue.location,
                description: task.Venue.description,
                image_url: task.Venue.image_url
            } : null,
            resource: task.Resource ? {
                resource_id: task.Resource.resource_id,
                name: task.Resource.name,
                description: task.Resource.description
            } : null,

            // Task Type Details
            task_types: task.TaskTypes?.map(tt => ({
                id: tt.id,
                task_name: tt.task_name,
                start_date: tt.start_date,
                end_date: tt.end_date,
                start_time: tt.start_time,
                end_time: tt.end_time,
                time_quota_hours: tt.time_quota_hours,
                venue_id: tt.venue_id,
                recurrence: tt.recurrence
            })) || [],

            // Assignees
            assignees: assignees,

            // Assignment Statistics
            assignment_stats: {
                total: totalAssignees,
                pending: pendingCount,
                accepted: acceptedCount,
                completed: completedCount,
                rejected: rejectedCount
            },

            // Closure Details
            closure_rules: task.TaskPackageClosures?.map(tpc => tpc.TaskClosure?.name) || [],

            // Timestamps
            created_at: task.created_at,
            updated_at: task.updated_at,

            // Action Button
            action_button: getTaskButtonState(task, userId, userRole)
        };

        res.json(response);

    } catch (error) {
        console.error('Error in getTaskDetail:', error);
        res.status(500).json({ message: error.message });
    }
};

// 7. Get Unapproved Tasks (Pending + Start Time <= Now)
exports.getUnapprovedTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const now = new Date();

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'pending' },
            include: [{
                model: Task,
                where: { is_deleted: false, status: { [Op.ne]: 'Inactive' } },
                include: [
                    { model: TaskType },
                    { model: Venue, attributes: ['name', 'location'] }
                ]
            }]
        });

        const filtered = assignments.filter(a => {
            const taskType = a.Task.TaskTypes && a.Task.TaskTypes[0];
            if (!taskType) return false;

            let startDateTime = null;
            if (taskType.task_name === 'Fixed Time Task' || taskType.task_name === 'Meeting') {
                if (taskType.start_date && taskType.start_time) {
                    const dateStr = new Date(taskType.start_date).toISOString().split('T')[0];
                    startDateTime = new Date(`${dateStr}T${taskType.start_time}`);
                } else if (taskType.start_date) {
                    startDateTime = new Date(taskType.start_date);
                }
            } else if (taskType.start_date) {
                startDateTime = new Date(taskType.start_date);
            }

            return startDateTime && startDateTime <= now;
        });

        const formatted = filtered.map(a => ({
            assignment_id: a.id,
            task_id: a.Task.task_id,
            title: a.Task.title,
            category: a.Task.category,
            priority: a.Task.priority,
            origin_type: a.Task.origin_type,
            start_date: a.Task.TaskTypes[0]?.start_date,
            start_time: a.Task.TaskTypes[0]?.start_time,
            location: a.Task.Venue ? a.Task.Venue.name : null,
            status: a.status
        }));

        // Manual pagination
        const paginated = formatted.slice(offset, offset + limit);

        res.json(getPagingData({ count: formatted.length, rows: paginated }, page, limit));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getTodaysTasksForUser = async (req, res) => {
    try {
        const userId = req.userId;
        const userRole = req.userRole;

        // Auto-pause/resume long tasks dynamically before fetching schedule
        const { adjustLongTaskStatus } = require('../utils/task-utils');
        await adjustLongTaskStatus(userId);

        // Helper: Get YYYY-MM-DD in local time (IST)
        const getLocalDateString = (d) => {
            const dateObj = new Date(d);
            const istOffset = 330 * 60 * 1000;
            const localDate = new Date(dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000) + istOffset);
            const year = localDate.getFullYear();
            const month = String(localDate.getMonth() + 1).padStart(2, '0');
            const day = String(localDate.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const todayStr = getLocalDateString(new Date());

        const assignments = await TaskAssign.findAll({
            where: { 
                user_id: userId, 
                status: { [Op.notIn]: ['pending', 'rejected'] } 
            },
            include: [{
                model: Task,
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
                include: [
                    { model: TaskType, required: true },
                    { model: Venue, attributes: ['name', 'location'] },
                    { model: TaskAssign } // For button state calculation
                ]
            }]
        });

        const isOccurrence = (targetDateStr, tStart, tEnd, recurrence) => {
            if (!tStart) return false;
            const startStr = getLocalDateString(tStart);
            const endStr = tEnd ? getLocalDateString(tEnd) : null;
            if (targetDateStr < startStr) return false;
            if (endStr && targetDateStr > endStr) return false;
            if (recurrence === 'none' || !recurrence) return targetDateStr === startStr;
            if (recurrence === 'daily') return true;
            
            const targetDate = new Date(`${targetDateStr}T00:00:00`);
            const startDate = new Date(`${startStr}T00:00:00`);
            if (recurrence === 'weekly') return targetDate.getDay() === startDate.getDay();
            if (recurrence === 'monthly') return targetDate.getDate() === startDate.getDate();
            return false;
        };

        const todaysTasks = [];
        assignments.forEach(a => {
            a.Task.TaskTypes.forEach(tt => {
                if (isOccurrence(todayStr, tt.start_date, tt.end_date, tt.recurrence)) {
                    todaysTasks.push({
                        assignment_id: a.id,
                        task_id: a.Task.task_id,
                        title: a.Task.title,
                        category: a.Task.category,
                        priority: a.Task.priority,
                        origin_type: a.Task.origin_type,
                        timing: {
                            start_time: tt.start_time,
                            end_time: tt.end_time,
                            recurrence: tt.recurrence,
                            task_name: tt.task_name // Added
                        },
                        is_package: a.Task.is_package, // Added
                        location: a.Task.Venue ? { name: a.Task.Venue.name, location: a.Task.Venue.location } : null,
                        status: a.status,
                        stage: a.Task.stage,
                        action_button: getTaskButtonState(a.Task, userId, userRole)
                    });
                }
            });
        });

        res.json({
            success: true,
            date: todayStr,
            count: todaysTasks.length,
            tasks: todaysTasks
        });

    } catch (error) {
        console.error('Error in getTodaysTasksForUser:', error);
        res.status(500).json({ message: error.message });
    }
};

// 8. Get Today's Approved Schedule
exports.getTodaysApprovedSchedule = async (req, res) => {
    try {
        const userId = req.userId;
        const { Op } = require('sequelize');

        // Auto-pause/resume long tasks dynamically before fetching schedule
        const { adjustLongTaskStatus } = require('../utils/task-utils');
        await adjustLongTaskStatus(userId);

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const todayDate = new Date();
        const todayStr = getLocalDateString(todayDate);

        const assignments = await TaskAssign.findAll({
            where: { user_id: userId, status: 'accepted' },
            include: [{
                model: Task,
                where: { 
                    is_deleted: false,
                    origin_type: { [Op.ne]: 'self-log' }
                },
                include: [
                    { model: TaskType, required: true },
                    { model: Venue, attributes: ['name', 'location'] }
                ]
            }]
        });

        const isOccurrence = (targetDateStr, tStart, tEnd, recurrence) => {
            const startStr = getLocalDateString(tStart);
            const endStr = tEnd ? getLocalDateString(tEnd) : null;
            if (targetDateStr < startStr) return false;
            if (endStr && targetDateStr > endStr) return false;
            if (recurrence === 'none') return targetDateStr === startStr;
            if (recurrence === 'daily') return true;
            const targetDate = new Date(`${targetDateStr}T00:00:00`);
            const startDate = new Date(`${startStr}T00:00:00`);
            if (recurrence === 'weekly') return targetDate.getDay() === startDate.getDay();
            if (recurrence === 'monthly') return targetDate.getDate() === startDate.getDate();
            return false;
        };

        const todaysTasks = [];
        assignments.forEach(a => {
            a.Task.TaskTypes.forEach(tt => {
                if (isOccurrence(todayStr, tt.start_date, tt.end_date, tt.recurrence)) {
                    todaysTasks.push({
                        assignment_id: a.id,
                        task_id: a.Task.task_id,
                        title: a.Task.title,
                        category: a.Task.category,
                        priority: a.Task.priority,
                        origin_type: a.Task.origin_type,
                        timing: {
                            start_time: tt.start_time,
                            end_time: tt.end_time,
                            recurrence: tt.recurrence
                        },
                        location: a.Task.Venue ? { name: a.Task.Venue.name, location: a.Task.Venue.location } : null,
                        status: a.status,
                        action_button: getTaskButtonState(a.Task, userId, req.userRole)                    });
                }
            });
        });

        // Sort by start time
        todaysTasks.sort((a, b) => (a.timing.start_time || '').localeCompare(b.timing.start_time || ''));

        res.json({
            date: todayStr,
            count: todaysTasks.length,
            tasks: todaysTasks
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Pause a task (only allowed when is_pause_allowed = true)
exports.pauseTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;

        const task = await Task.findOne({ where: { task_id: taskId, is_deleted: false } });
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Guard: only tasks that allow pausing can be paused
        if (!task.is_pause_allowed) {
            return res.status(403).json({ message: 'This task does not allow pausing (is_pause_allowed is false)' });
        }

        if (task.is_paused) {
            return res.status(400).json({ message: 'Task is already paused' });
        }

        await task.update({ is_paused: true, status: 'PAUSED' });

        // Update all active individual assignments to 'paused'
        await TaskAssign.update(
            { status: 'paused' },
            { where: { task_id: taskId, status: { [Op.in]: ['accepted', 'in_progress'] } } }
        );

        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'pause',
            details: `Task paused by user ${userId} at ${new Date().toISOString()}`
        });

        // After manual pause, check if status needs further adjustment (usually not, but for consistency)
        await adjustLongTaskStatus(userId);

        res.json({
            message: 'Task paused successfully',
            task_id: task.task_id,
            is_paused: true
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Resume a paused task (only allowed when is_pause_allowed = true)
exports.resumeTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;

        const task = await Task.findOne({ where: { task_id: taskId, is_deleted: false } });
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Guard: only tasks that allow pausing can be resumed
        if (!task.is_pause_allowed) {
            return res.status(403).json({ message: 'This task does not allow pause/resume (is_pause_allowed is false)' });
        }

        if (!task.is_paused) {
            return res.status(400).json({ message: 'Task is not currently paused' });
        }

        await task.update({ is_paused: false, status: 'RESUMED' });

        // Update all paused assignments back to 'accepted' (and let adjustLongTaskStatus decide if it should be in_progress)
        await TaskAssign.update(
            { status: 'accepted' },
            { where: { task_id: taskId, status: 'paused' } }
        );

        await TaskLog.create({
            task_id: taskId,
            user_id: userId,
            action: 'resume',
            details: `Task resumed by user ${userId} at ${new Date().toISOString()}`
        });

        // After manual resume, adjust status based on currents overlaps
        await adjustLongTaskStatus(userId);

        res.json({
            message: 'Task resumed successfully',
            task_id: task.task_id,
            is_paused: false
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7.5. Get Unified Daily Tasks (Directives + Self-Logs)
exports.getDailyTasks = async (req, res) => {
    try {
        const userId = req.userId;
        const { date } = req.query; // Expect YYYY-MM-DD
        const { Op } = require('sequelize');

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        let targetDate = date ? new Date(date) : new Date();

        // --- NEW: Visibility Rule Refinement ---
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        // Fetch user role to determine the visibility shift time
        const { User } = require('../models');
        const user = await User.findByPk(userId);
        const isStudent = user && user.role && user.role.toLowerCase() === 'student';

        // Visibility Shift Rules:
        // Students: Shift to tomorrow at 7:00 PM (19:00)
        // Others: Shift to tomorrow at 4:30 PM (16:30)
        let shouldShiftToTomorrow = false;

        if (!date) {
            if (isStudent) {
                if (localNow.getHours() >= 19) {
                    shouldShiftToTomorrow = true;
                }
            } else {
                if (localNow.getHours() >= 16 && (localNow.getHours() > 16 || localNow.getMinutes() >= 30)) {
                    shouldShiftToTomorrow = true;
                }
            }
        }

        if (shouldShiftToTomorrow) {
            targetDate.setDate(targetDate.getDate() + 1);

            // If tomorrow is Sunday, skip to Monday
            if (targetDate.getDay() === 0) {
                targetDate.setDate(targetDate.getDate() + 1);
            }
        }

        const dateString = getLocalDateString(targetDate);

        // 1. Fetch Directive Tasks (Assigned to the user)
        // Including pending, accepted, rejected
        const directAssignments = await TaskAssign.findAll({
            where: {
                user_id: userId,
                status: { [Op.in]: ['pending', 'accepted', 'rejected', 'in_progress', 'completed'] }
            },
            include: [{
                model: Task,
                where: {
                    origin_type: 'directive',
                    is_deleted: false
                },
                include: [
                    { model: TaskType, required: true },
                    { model: Task, as: 'Parent', attributes: ['task_id', 'title'] }
                ]
            }],
            order: [['id', 'DESC']]
        });

        // 2. Fetch Self-Log Tasks (Created by the user)
        const selfLogsRaw = await Task.findAll({
            where: {
                creator_id: userId,
                origin_type: 'self-log',
                is_deleted: false
            },
            include: [{
                model: TaskType,
                required: true
            }],
            order: [['task_id', 'DESC']]
        });

        const directives = [];
        const floatingTasks = [];
        const selfLogs = [];

        // Sorting & Persistence Logic
        const processTask = (t, status, assignmentId = null) => {
            const tt = t.TaskTypes?.[0];
            if (!tt) return;

            const isFloating = tt.task_name === 'Floating Task';
            const startDateStr = getLocalDateString(tt.start_date);
            const endDateStr = getLocalDateString(tt.end_date || tt.start_date);

            // Visibility Logic for Floating/Long Tasks
            let shouldShow = false;
            if (isFloating) {
                if (status === 'completed') {
                    // Completed floating tasks only show on the completion day (or start day if we don't have completed_at)
                    // For now, let's say they only show on the specific target date if it perfectly matches the completion date context.
                    // Actually, simple rule: if completed, only show if targetDate == startDate (as a record).
                    shouldShow = (dateString >= startDateStr && dateString <= endDateStr);
                    // But if it's completed, we usually only want it to appear once as a finished record.
                    // Let's refine: if completed, only show on the day it was supposed to be done.
                    if (status === 'completed' && dateString !== startDateStr) shouldShow = false;
                } else {
                    // Not completed: show every day in range
                    shouldShow = (dateString >= startDateStr && dateString <= endDateStr);
                }
            } else {
                // Regular tasks only show on their specific day or range
                shouldShow = (dateString >= startDateStr && dateString <= endDateStr);
            }

            if (shouldShow) {
                const formatted = {
                    task_id: t.task_id,
                    assignment_id: assignmentId,
                    title: t.title,
                    description: t.description,
                    category: t.category,
                    priority: t.priority,
                    status: status,
                    is_paused: t.is_paused,
                    is_document: t.is_document,
                    is_mandatory: t.is_mandatory,
                    is_package: t.is_package,
                    parent_task_id: t.parent_task_id,
                    parent_title: t.Parent?.title,
                    venue_id: tt.venue_id,
                    start_date: startDateStr,
                    end_date: endDateStr,
                    start_time: (tt.task_name === 'Long Task' || tt.task_name === 'Date-Only / Long Task')
                        ? (tt.start_time || '08:45:00') : tt.start_time,
                    end_time: (tt.task_name === 'Long Task' || tt.task_name === 'Date-Only / Long Task')
                        ? (tt.end_time || '16:30:00') : tt.end_time,
                    time_quota_hours: tt.time_quota_hours,
                    max_acceptances: tt.max_acceptances,
                    sequence_order: t.sequence_order || 0,
                    task_name: tt.task_name,
                    sub_tasks: [],
                    action_button: getTaskButtonState(t, userId, req.userRole)                };

                if (isFloating) floatingTasks.push(formatted);
                else directives.push(formatted);
            }
        };

        directAssignments.forEach(a => processTask(a.Task, a.status, a.id));

        // Self logs are always 'Active' unless we add assignment status for them too
        selfLogsRaw.forEach(s => {
            const tt = s.TaskTypes?.[0];
            if (!tt) return;
            const startDateStr = getLocalDateString(tt.start_date);
            const endDateStr = getLocalDateString(tt.end_date || tt.start_date);
            if (dateString >= startDateStr && dateString <= endDateStr) {
                selfLogs.push({
                    task_id: s.task_id,
                    title: s.title,
                    status: 'Active',
                    category: s.category,
                    priority: s.priority,
                    time: {
                        start_time: tt.start_time,
                        end_time: tt.end_time,
                        recurrence: tt.recurrence,
                        task_name: tt.task_name
                    }
                });
            }
        });

        // 3. Nest Sub-tasks under Parents
        const buildTaskTree = (flatTasks) => {
            const taskMap = {};
            const rootTasks = [];

            flatTasks.forEach(task => {
                taskMap[task.task_id] = task;
            });

            flatTasks.forEach(task => {
                if (task.parent_task_id && taskMap[task.parent_task_id]) {
                    taskMap[task.parent_task_id].sub_tasks.push(task);
                    // Sort sub-tasks by sequence_order
                    taskMap[task.parent_task_id].sub_tasks.sort((a, b) => a.sequence_order - b.sequence_order);
                } else {
                    rootTasks.push(task);
                }
            });

            return rootTasks;
        };

        const nestedDirectives = buildTaskTree(directives);
        const nestedFloating = buildTaskTree(floatingTasks);

        // --- NEW: Priority & Mandatory Sorting ---
        const priorityOrder = { 'critical': 4, 'high': 3, 'medium': 2, 'low': 1 };
        const sortTasks = (tasks) => {
            return tasks.sort((a, b) => {
                // 1. Priority
                const pA = priorityOrder[a.priority?.toLowerCase()] || 1;
                const pB = priorityOrder[b.priority?.toLowerCase()] || 1;
                if (pA !== pB) return pB - pA;

                // 2. Mandatory status
                if (a.is_mandatory && !b.is_mandatory) return -1;
                if (!a.is_mandatory && b.is_mandatory) return 1;

                // 3. Start Time (Earlier wins)
                if (a.start_time !== b.start_time) {
                    return (a.start_time || '23:59:59') < (b.start_time || '23:59:59') ? -1 : 1;
                }

                // 4. Creation Order (Newer wins)
                return b.task_id - a.task_id;
            });
        };

        sortTasks(nestedDirectives);
        sortTasks(nestedFloating);

        res.json({
            date: dateString,
            directives: nestedDirectives,
            floating_tasks: nestedFloating,
            self_logs: selfLogs
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7.6. Get Specialized Daily Task Report (Strictly Created by User)
exports.getDailyTaskReport = async (req, res) => {
    try {
        const userId = req.userId;
        let { date } = req.query; // Expect YYYY-MM-DD
        const { Op } = require('sequelize');

        // Helper: Get YYYY-MM-DD in local time
        const getLocalDateString = (d) => {
            if (!d) return null;
            const dateObj = new Date(d);
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // If no date provided, use today's local date
        if (!date) {
            date = getLocalDateString(new Date());
        }

        // Helper: Check if a date matches a task's schedule (including recurrence)
        const isOccurrence = (targetDateStr, tStart, tEnd, recurrence) => {
            const startStr = getLocalDateString(tStart);
            const endStr = tEnd ? getLocalDateString(tEnd) : null;

            if (targetDateStr < startStr) return false;
            if (endStr && targetDateStr > endStr) return false;

            if (recurrence === 'none') return targetDateStr === startStr;
            if (recurrence === 'daily') return true;

            const targetDate = new Date(`${targetDateStr}T00:00:00`);
            const startDate = new Date(`${startStr}T00:00:00`);

            if (recurrence === 'weekly') return targetDate.getDay() === startDate.getDay();
            if (recurrence === 'monthly') return targetDate.getDate() === startDate.getDate();
            return false;
        };

        const tasks = await Task.findAll({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType, required: true },
                { model: Venue, attributes: ['name', 'location'] },
                {
                    model: TaskPackageClosure,
                    include: [{ model: TaskClosure, attributes: ['name'] }]
                },
                {
                    model: TaskAssign,
                    required: false,
                    include: [{
                        model: User,
                        attributes: ['user_id', 'role'],
                        include: [
                            { model: Student, attributes: ['name'] },
                            { model: Faculty, attributes: ['name'] },
                            { model: Staff, attributes: ['name'] },
                            { model: RoleUser, attributes: ['name'] }
                        ]
                    }]
                }
            ],
            order: [['task_id', 'DESC']]
        });

        const formatTask = (task) => {
            const type = task.TaskTypes?.[0] || {};
            let assignees = [];
            if (task.TaskAssigns) {
                assignees = task.TaskAssigns.map(a => {
                    const u = a.User || {};
                    const profile = u.Student || u.Faculty || u.Staff || u.RoleUser || {};
                    return {
                        assignment_id: a.id,
                        user_id: a.user_id,
                        status: a.status,
                        name: profile.name || 'Unknown',
                        role: u.role
                    };
                });
            }

            const selfAssignment = task.TaskAssigns?.find(a => a.user_id == userId);
            const closureMethods = (task.TaskPackageClosures || []).map(c => c.TaskClosure?.name).filter(Boolean);

            return {
                task_id: task.task_id,
                title: task.title,
                description: task.description,
                category: task.category,
                priority: task.priority,
                origin_type: task.origin_type,
                status: selfAssignment ? selfAssignment.status : (task.status || 'Active'),
                is_mandatory: task.is_mandatory,
                is_document: task.is_document,
                score: task.score,
                penalty_per_hour: task.penalty_per_hour,
                creator_id: task.creator_id,
                assignees: assignees,
                venue: task.Venue ? {
                    name: task.Venue.name,
                    location: task.Venue.location
                } : null,
                closure_methods: closureMethods,
                time: {
                    start_date: type.start_date,
                    end_date: type.end_date,
                    start_time: type.start_time,
                    end_time: type.end_time,
                    recurrence: type.recurrence
                }
            };
        };

        // Filter, Categorize, and Group
        const directiveTasks = [];
        const selfLogTasks = [];
        const formattedMap = new Map();
        const signatureToTaskId = new Map(); // Sig -> KeptTaskId (for recurring grouping)
        const taskIdToKeptId = new Map();    // Every TaskID -> Representative TaskID

        const isAll = req.query.date === 'All' || !req.query.date;

        tasks.forEach(task => {
            const type = task.TaskTypes?.[0];
            if (!type) return;

            // If "All", skip date matching. Otherwise, check if target date matches occurrence.
            const matchesDate = isAll || !req.query.date || isOccurrence(date, type.start_date, type.end_date, type.recurrence);

            if (matchesDate) {
                const formatted = formatTask(task);
                let keptId = formatted.task_id;

                // Grouping logic for consolidated view (especially when viewing "All")
                if (isAll) {
                    // Simplified signature for more aggressive grouping
                    const cleanTitle = (task.title || '').trim().toLowerCase();
                    const sig = `${cleanTitle}|${task.creator_id}|${type.start_time || ''}`;
                    
                    if (signatureToTaskId.has(sig)) {
                        keptId = signatureToTaskId.get(sig);
                        const representative = formattedMap.get(keptId);
                        
                        // Update the representative's date range
                        if (type.start_date && (!representative.time.start_date || new Date(type.start_date) < new Date(representative.time.start_date))) {
                            representative.time.start_date = type.start_date;
                        }
                        if (type.end_date && (!representative.time.end_date || new Date(type.end_date) > new Date(representative.time.end_date))) {
                            representative.time.end_date = type.end_date;
                        }
                        
                        // Increment occurrence count if you ever want to show "X occurrences"
                        representative.occurrence_count = (representative.occurrence_count || 1) + 1;
                        
                        taskIdToKeptId.set(task.task_id, keptId);
                        return; 
                    } else {
                        signatureToTaskId.set(sig, keptId);
                    }
                }

                taskIdToKeptId.set(task.task_id, keptId);
                formatted.parent_task_id = task.parent_task_id; // Store for hierarchy building
                formattedMap.set(formatted.task_id, formatted);
            }
        });

        // Hierarchy Builder
        formattedMap.forEach(formatted => {
            // Determine the effective parent ID (mapping skipped parent occurrences to their representative)
            let effectiveParentId = formatted.parent_task_id;
            if (effectiveParentId && taskIdToKeptId.has(effectiveParentId)) {
                effectiveParentId = taskIdToKeptId.get(effectiveParentId);
            }

            // Check if this task is a child AND its (mapped) parent is in the same report
            if (effectiveParentId && formattedMap.has(effectiveParentId)) {
                const parent = formattedMap.get(effectiveParentId);
                
                // Avoid self-nesting if grouping logic mapped child to itself or its own parent
                if (parent.task_id !== formatted.task_id) {
                    if (formatted.title && (formatted.title.startsWith('Permission:') || formatted.title.startsWith('Approval Request:'))) {
                        parent.approvals = parent.approvals || [];
                        parent.approvals.push(formatted);
                    } else {
                        parent.sub_tasks = parent.sub_tasks || [];
                        parent.sub_tasks.push(formatted);
                    }
                    delete formatted.parent_task_id;
                    return; // Successfully nested
                }
            }
            
            // Top Level Task (or grouping representative)
            delete formatted.parent_task_id;

            if (formatted.origin_type === 'self-log') {
                selfLogTasks.push(formatted);
            } else {
                directiveTasks.push(formatted);
            }
        });

        res.json({
            report_for_user: userId,
            date: req.query.date || "All",
            total_task: directiveTasks.length + selfLogTasks.length, // Only count top-level tasks
            directive_task_count: directiveTasks.length,
            self_log_count: selfLogTasks.length,
            directive_tasks: directiveTasks,
            self_log_tasks: selfLogTasks
        });

    } catch (error) {
        console.error(`[DailyReport] Error: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};

// 7.7. Get My Escalations (where user is either creator or rejected_user)
exports.getMyEscalations = async (req, res) => {
    try {
        const userId = req.userId;
        const { Task, TaskAssign, User, TaskType } = require('../models');
        const { Op } = require('sequelize');

        // 1. Find tasks created by user that have escalated or rejected assignments
        const escalatedTasks = await Task.findAll({
            where: { creator_id: userId, is_deleted: false },
            include: [
                { model: TaskType },
                {
                    model: TaskAssign,
                    where: { status: { [Op.in]: ['escalated', 'rejected'] } },
                    required: true,
                    include: [{ model: User, attributes: ['user_id', 'role'] }]
                }
            ]
        });

        const taskGroups = [];

        for (const task of escalatedTasks) {
            const tt = task.TaskTypes?.[0];

            // Fetch ALL assignments for this task to provide the full summary counts
            const allAssigns = await TaskAssign.findAll({
                where: { task_id: task.task_id }
            });

            const stats = {
                total_assignees: allAssigns.length,
                accepted_count: allAssigns.filter(a => a.status === 'accepted').length,
                pending_count: allAssigns.filter(a => a.status === 'pending').length,
                rejected_count: allAssigns.filter(a => a.status === 'rejected').length,
                escalated_count: allAssigns.filter(a => a.status === 'escalated').length
            };

            taskGroups.push({
                task_id: task.task_id,
                title: task.title,
                timing: `${tt.start_date} ${tt.start_time}`,
                priority: task.priority,
                stats: stats,
                summary: `${stats.escalated_count} escalated, ${stats.rejected_count} rejected out of ${stats.total_assignees} total assignees (${stats.accepted_count} accepted, ${stats.pending_count} pending)`,
                escalated_assignees: task.TaskAssigns.map(ea => ({
                    user_id: ea.user_id,
                    role: ea.User?.role,
                    status: ea.status,
                    reason: ea.reason
                }))
            });
        }

        res.json({
            count: taskGroups.length,
            escalations: taskGroups
        });
    } catch (error) {
        console.error(`[Escalation] Error: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:id/analysis
// Comprehensive task lifecycle analysis: Logs, transfers, and role-wise stats
// ─────────────────────────────────────────────────────────────────────────────
exports.getTaskAnalysis = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId;
        const { TaskLog, TaskAssign, User, Student, Faculty, Staff, RoleUser, TaskType } = require('../models');

        // 1. Fetch Task Info
        const task = await Task.findByPk(taskId, {
            include: [
                { model: TaskType },
                {
                    model: User, as: 'Creator',
                    include: [
                        { model: Student, attributes: ['name'] },
                        { model: Faculty, attributes: ['name'] },
                        { model: Staff, attributes: ['name'] },
                        { model: RoleUser, attributes: ['name'] }
                    ]
                }
            ]
        });

        if (!task) return res.status(404).json({ message: 'Task not found' });

        // 2. Fetch All Assignments
        const assignments = await TaskAssign.findAll({
            where: { task_id: taskId },
            include: [{
                model: User,
                include: [
                    { model: Student, attributes: ['name'] },
                    { model: Faculty, attributes: ['name'] },
                    { model: Staff, attributes: ['name'] },
                    { model: RoleUser, attributes: ['name'] }
                ]
            }]
        });

        // 3. Fetch All Logs
        const logs = await TaskLog.findAll({
            where: { task_id: taskId },
            include: [{
                model: User,
                include: [
                    { model: Student, attributes: ['name'] },
                    { model: Faculty, attributes: ['name'] },
                    { model: Staff, attributes: ['name'] },
                    { model: RoleUser, attributes: ['name'] }
                ]
            }],
            order: [['created_at', 'ASC']]
        });

        // --- Helper for name resolution ---
        const getProfileName = (u) => {
            if (!u) return 'System';
            const p = u.Student || u.Faculty || u.Staff || u.RoleUser;
            return p ? p.name : (u.role === 'admin' ? 'Administrator' : `User #${u.user_id}`);
        };

        // 4. Calculate Stats by Role
        const stats = {
            total_assignments: assignments.length,
            roles: {}
        };

        assignments.forEach(a => {
            const role = a.User?.role || 'unknown';
            if (!stats.roles[role]) {
                stats.roles[role] = { total: 0, pending: 0, accepted: 0, completed: 0, rejected: 0 };
            }
            stats.roles[role].total++;
            if (stats.roles[role][a.status] !== undefined) {
                stats.roles[role][a.status]++;
            }
        });

        // 5. Format Timeline/Logs
        const timeline = logs.map(l => {
            let actionText = l.action;
            let detailItems = [];

            if (l.action === 'reject_and_transfer') {
                actionText = 'transfer';
            }

            const formattedLog = {
                time: l.created_at,
                action: actionText,
                performer: getProfileName(l.User),
                performer_role: l.User?.role,
                details: l.details
            };

            // Attempt to resolve "To Whom" in re-transfers
            if (l.action === 'reject_and_transfer') {
                const targetAssign = assignments.find(a =>
                    a.reason && (a.reason.includes(`Transferred from ${l.user_id}`) || a.reason.includes(`from ${l.user_id}`))
                );
                if (targetAssign) {
                    formattedLog.transferred_to = getProfileName(targetAssign.User);
                    formattedLog.transfer_reason = l.details;
                    formattedLog.summary = `${formattedLog.performer} transferred task to ${formattedLog.transferred_to}`;
                } else {
                    formattedLog.summary = `${formattedLog.performer} rejected and requested transfer`;
                }
            } else if (l.action === 'accept' || l.action === 'accepted') {
                formattedLog.summary = `${formattedLog.performer} accepted the task`;
            } else if (l.action === 'pause') {
                formattedLog.summary = `${formattedLog.performer} paused the task`;
            } else if (l.action === 'resume') {
                formattedLog.summary = `${formattedLog.performer} resumed the task`;
            } else if (l.action === 'submit_proof') {
                formattedLog.summary = `${formattedLog.performer} submitted proof/completed task`;
            } else {
                formattedLog.summary = `${formattedLog.performer} performed ${actionText}`;
            }

            return formattedLog;
        });

        // Add "Task Created" if not in logs
        if (!timeline.find(log => log.action === 'create' || log.action === 'created')) {
            timeline.unshift({
                time: task.created_at,
                action: 'created',
                performer: getProfileName(task.Creator),
                performer_role: task.Creator?.role,
                summary: `Task created by ${getProfileName(task.Creator)}`
            });
        }

        res.json({
            task: {
                id: task.task_id,
                title: task.title,
                category: task.category,
                priority: task.priority,
                is_approved: task.is_approved,
                is_paused: task.is_paused,
                created_at: task.created_at
            },
            statistics: stats,
            timeline: timeline
        });

    } catch (error) {
        console.error("TASK ANALYSIS ERROR:", error);
        res.status(500).json({ message: error.message });
    }
};

// 12. Notify Pending Assignees (Students)
exports.notifyPendingAssignees = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const userId = req.userId; // user requesting to notify (creator or admin)

        const task = await Task.findByPk(taskId, {
            include: [{
                model: TaskAssign,
                where: { status: 'pending' },
                required: false,
                include: [{ model: User, attributes: ['user_id', 'role'] }]
            }]
        });

        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Authorization: only creator or admin can trigger this
        const reqUser = await User.findByPk(userId);
        if (task.creator_id !== userId && reqUser.role.toLowerCase() !== 'admin' && task.faculty_id !== userId) {
            return res.status(403).json({ message: 'You are not authorized to notify assignees for this task' });
        }

        const pendingAssignments = task.TaskAssigns || [];
        let notifiedCount = 0;

        for (const assign of pendingAssignments) {
            if (assign.User && assign.User.role && assign.User.role.toLowerCase() === 'student') {
                // Send notification
                await createNotification({
                    userId: assign.user_id,
                    venueId: task.venue_id,
                    title: 'Action Required: Accept Task',
                    msg: `You have a pending task "${task.title}". Please accept or reject it.`,
                    type: 'task_reminder'
                });
                notifiedCount++;
            }
        }

        res.json({
            message: `Successfully notified ${notifiedCount} pending student assignee(s).`,
            notified_count: notifiedCount
        });

    } catch (error) {
        console.error('Error in notifyPendingAssignees:', error);
        res.status(500).json({ message: error.message });
    }
};

// Review Task Proof (Approve/Reject)
exports.reviewTaskProof = async (req, res) => {
    const t = await Task.sequelize.transaction();
    try {
        const { id: assignmentId } = req.params;
        const { status, reason } = req.body; // status: 'approved' or 'rejected'
        const userId = req.userId;

        const assignment = await TaskAssign.findByPk(assignmentId, {
            include: [{ model: Task }]
        });

        if (!assignment) {
            await t.rollback();
            return res.status(404).json({ message: 'Assignment not found' });
        }

        // Only creator or faculty can review
        const isManager = assignment.Task.creator_id == userId || assignment.Task.faculty_id == userId;
        if (!isManager && req.userRole !== 'admin') {
            await t.rollback();
            return res.status(403).json({ message: 'Permission denied: Only managers can review proofs' });
        }

        if (status === 'approved') {
            await assignment.update({
                status: 'completed',
                reason: reason || 'Proof approved'
            }, { transaction: t });
        } else {
            // Rejection: move back to 'accepted' or 'in_progress' so they can resubmit
            await assignment.update({
                status: 'accepted',
                proof: null,
                reason: reason || 'Proof rejected'
            }, { transaction: t });
        }

        await TaskLog.create({
            task_id: assignment.task_id,
            user_id: userId,
            action: `proof_${status}`,
            details: `Proof ${status} by manager ${userId}. Reason: ${reason || 'N/A'}`
        }, { transaction: t });

        await t.commit();

        // Notification (Async)
        (async () => {
            try {
                const { Notification } = require('../models');
                await Notification.create({
                    user_id: assignment.user_id,
                    title: status === 'approved' ? 'Proof Approved' : 'Proof Rejected',
                    msg: status === 'approved'
                        ? `Your proof for task "${assignment.Task.title}" was approved.`
                        : `Your proof for task "${assignment.Task.title}" was rejected. Reason: ${reason || 'N/A'}. Please resubmit.`,
                    type: status === 'approved' ? 'task_completed' : 'task_rejected'
                });
            } catch (err) {
                console.error('Notification error in reviewTaskProof:', err);
            }
        })();

        res.json({ message: `Proof successfully ${status}` });

    } catch (error) {
        if (t) await t.rollback();
        res.status(500).json({ message: error.message });
    }
};

exports.rescheduleTask = async (req, res) => {
    try {
        const { id: taskId } = req.params;
        const { new_date, new_time, new_end_date, new_end_time, self_assign } = req.body;
        const userId = req.userId;

        // --- NEW: Future Time Constraint ---
        const now = new Date();
        const istOffset = 330 * 60 * 1000;
        const localNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const scheduledTime = new Date(`${new_date}T${new_time || '00:00:00'}`);
        if (scheduledTime < localNow) {
            return res.status(400).json({ message: 'Rescheduled time must be in the future.' });
        }

        const task = await Task.findByPk(taskId, {
            include: [{ model: TaskType }]
        });

        if (!task || task.is_deleted) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // 1. Update Task Timing
        if (task.TaskTypes && task.TaskTypes.length > 0) {
            // Logic: If no end time given, default to +2 hours from start if same day, or 23:59:59
            let endTime = new_end_time || '23:59:59';
            if (!new_end_time && new_time) {
                const [h, m] = new_time.split(':');
                const endH = (parseInt(h) + 2) % 24;
                endTime = `${String(endH).padStart(2, '0')}:${m}:00`;
            }

            await TaskType.update({
                start_date: new_date,
                end_date: new_end_date || new_date,
                start_time: new_time || '08:00:00',
                end_time: endTime
            }, {
                where: { task_id: taskId }
            });
        }

        // 2. Resolve Escalation State completely
        const { resolveTaskEscalations } = require('../utils/task-utils');
        await resolveTaskEscalations(taskId, userId);
        // Explicitly clear task status and flags
        await task.update({ is_escalate: false, status: 'Active', stage: 'Active' });

        // 3. Optional Assignees or Self-Assignment (Common for directed resolutions)
        if (req.body.assignee_ids && Array.isArray(req.body.assignee_ids) && req.body.assignee_ids.length > 0) {
            // Re-assign to selected users
            for (const uid of req.body.assignee_ids) {
                const existing = await TaskAssign.findOne({ where: { task_id: taskId, user_id: uid } });
                if (!existing) {
                    await TaskAssign.create({
                        task_id: taskId,
                        user_id: uid,
                        status: 'pending',
                        accepted_at: null
                    });
                } else {
                    await existing.update({ status: 'pending', accepted_at: null, reason: 'Re-assigned during reschedule' });
                }
            }
            await task.update({ stage: 'Active' });
        } else if (self_assign) {
            const existing = await TaskAssign.findOne({ where: { task_id: taskId, user_id: userId } });
            if (!existing) {
                await TaskAssign.create({
                    task_id: taskId,
                    user_id: userId,
                    status: 'accepted',
                    accepted_at: new Date()
                });
            } else {
                await existing.update({ status: 'accepted', accepted_at: new Date(), reason: 'Rescheduled for execution' });
            }
            await task.update({ stage: 'activity_start' });
        }

        res.json({ success: true, message: 'Task rescheduled and resolved successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.verifyTaskProof = async (req, res) => {
    try {
        const userId = req.userId;
        const { id, assignmentId } = req.params;
        const { action, reason } = req.body; // action: 'approve' or 'reject'

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: "Action must be 'approve' or 'reject'" });
        }

        const task = await Task.findByPk(id, { include: [{ model: TaskType }] });
        if (!task) return res.status(404).json({ message: 'Task not found' });

        if (String(task.creator_id) !== String(userId)) {
            return res.status(403).json({ message: 'Only the task creator can verify proofs' });
        }

        const assignment = await TaskAssign.findOne({
            where: {
                id: assignmentId,
                task_id: id,
                verification_status: 'pending'
            }
        });

        if (!assignment) {
            return res.status(404).json({ message: 'Pending verification assignment not found' });
        }

        const taskType = task.TaskTypes && task.TaskTypes[0];
        let penalty = 0;
        let earnedScore = 0;

        const submittedTime = assignment.submitted_time ? new Date(assignment.submitted_time) : new Date();
        const deadline = taskType && taskType.end_date ? new Date(taskType.end_date) : null;

        // Calculate penalty based on submitted_time, not current time
        if (deadline && submittedTime > deadline) {
            const diffMs = submittedTime - deadline;
            const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
            penalty = diffHours * parseFloat(task.penalty_per_hour || 0);
        }

        earnedScore = parseFloat(task.score || 0) - penalty;

        if (action === 'approve') {
            await assignment.update({
                verification_status: 'verified',
                status: 'completed',
                earned_score: earnedScore,
                penalty_applied: penalty
            });

            // Update User Profile
            const user = await User.findByPk(assignment.user_id);
            let profile = null;
            if (user) {
                if (user.role === 'student') profile = await Student.findOne({ where: { user_id: assignment.user_id } });
                else if (user.role === 'faculty') profile = await Faculty.findOne({ where: { user_id: assignment.user_id } });
                else if (user.role === 'role-user') profile = await RoleUser.findOne({ where: { user_id: assignment.user_id } });
                else if (user.role === 'staff') profile = await Staff.findOne({ where: { user_id: assignment.user_id } });

                if (profile) {
                    const currentScore = parseFloat(profile.score || 0);
                    const currentPenalty = parseFloat(profile.penalty || 0);
                    const currentTotalScore = parseFloat(profile.total_score || 0);

                    await profile.update({
                        score: currentScore + earnedScore,
                        penalty: currentPenalty + penalty,
                        total_score: currentTotalScore + parseFloat(task.score)
                    });
                }
            }

            // Adjust Long Task Status (Resume if any)
            const { adjustLongTaskStatus } = require('../utils/task-utils');
            await adjustLongTaskStatus(assignment.user_id);

            await TaskLog.create({
                task_id: id,
                user_id: assignment.user_id,
                action: 'proof_verified',
                details: `Creator approved the submitted proof.`
            });

            await Notification.create({
                user_id: assignment.user_id,
                title: 'Proof Verified',
                msg: `Your proof for "${task.title}" was verified and completed.`,
                type: 'task_verified'
            });

            return res.json({ message: 'Proof verified and task completed successfully', earnedScore, penalty });
        } 
        else if (action === 'reject') {
            const newCount = assignment.proof_rejection_count + 1;
            
            if (newCount >= 3) {
                // 3 strike rule
                await assignment.update({
                    verification_status: 'rejected',
                    status: 'completed',
                    proof_rejection_count: newCount,
                    proof_rejection_reason: reason || 'Rejected for the 3rd time. 0 points awarded.',
                    earned_score: 0,
                    penalty_applied: task.score || 0
                });

                await TaskLog.create({
                    task_id: id,
                    user_id: assignment.user_id,
                    action: 'proof_rejected',
                    details: 'Proof rejected 3 times. Task closed with 0 points.'
                });

                await Notification.create({
                    user_id: assignment.user_id,
                    title: 'Proof Rejected (Final)',
                    msg: `Your proof for "${task.title}" was rejected for the 3rd time. 0 points awarded.`,
                    type: 'task_rejected_final'
                });

                return res.json({ message: 'Proof rejected 3 times. Task closed with 0 points.' });
            } else {
                // 4 working hours deadline from now
                const now = new Date();
                const resubmissionDeadline = new Date(now.getTime() + (4 * 60 * 60 * 1000)); // 4 hours

                await assignment.update({
                    verification_status: 'rejected',
                    status: 'in_progress', // Put it back to in_progress so they have to submit again
                    proof: null, // Clear the invalid proof
                    submitted_time: null, // Unset the submission time
                    proof_rejection_count: newCount,
                    proof_rejection_reason: reason,
                    resubmission_deadline: resubmissionDeadline
                });

                await TaskLog.create({
                    task_id: id,
                    user_id: assignment.user_id,
                    action: 'proof_rejected',
                    details: `Proof rejected (Strike ${newCount}/3). Reason: ${reason || 'N/A'}`
                });

                await Notification.create({
                    user_id: assignment.user_id,
                    title: 'Proof Rejected',
                    msg: `Your proof for "${task.title}" was rejected. Please resubmit within 4 hours. Reason: ${reason || 'N/A'}`,
                    type: 'task_rejected'
                });

                return res.json({ message: `Proof rejected. Assignee has 4 hours to resubmit. (${3 - newCount} attempts left)` });
            }
        }

    } catch (error) {
        console.error('verifyTaskProof Error:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = exports;