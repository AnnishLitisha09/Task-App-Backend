# Comprehensive Technical Deep-Dive: Task Management System

This document is the "Master Reference" for the Task App Backend, providing over 500 lines of detailed technical analysis, API mappings, and business logic specifications.

---

## 1. Core Architectural Pillars

### 1.1 Organizational Hierarchy (The "Rules of Engagement")
The backend enforces a strict hierarchical flow for all task-related entities. This hierarchy is used for **Visibility**, **Assignment**, and **Escalation**:

- **System Admin**: 
  - Overwrites all permissions.
  - Manages masters: Venues, Roles, Departments, Task Titles.
  - No "Supervisor" (top of the chain).
- **Principal (Role: 2)**:
  - Global institutional visibility.
  - Can assign tasks to ANY HOD, Faculty, or Student.
  - Receives escalations from HODs.
- **HOD (Role-User assigned to Dept)**:
  - Visibility locked to their assigned `department_id`.
  - Can assign tasks to Faculty and Students within their department.
  - Receives escalations from Faculty.
- **Faculty (Role: 1)**:
  - Manages Student groups (Mentees).
  - Can assign to their Mentees or any Student in their Dept.
  - Receives escalations from Students.
- **Student/Staff (Role: 0)**:
  - Primary executors.
  - No assignment permissions (Student can create personal "Self Logs").

### 1.2 Data Persistence Strategy
Using **Sequelize (MySQL)** with eager loading to minimize round-trips.
- **Paranoid Deletion**: Many tables (`tasks`, `task_titles`, `resources`) use soft-delete (`deletedAt`) to preserve historical logs.
- **Transactions**: All critical flows (e.g., Task Creation -> Type -> Assign -> Notify) are wrapped in `sequelize.transaction()` to prevent partial data states.

---

## 2. Exhaustive Database Schema Reference

### 2.1 Identity & Access Management (IAM)
- **`users`**:
  - `user_id` (PK)
  - `role` (ENUM: admin, faculty, student, staff, role-user)
  - `status` (active/inactive)
- **`auth_accounts`**:
  - `user_id` (FK -> users)
  - `email` (Unique)
  - `hashed_password` (Bcrypt)
- **`role_assignments`**:
  - `ra_id` (PK)
  - `user_id` (FK)
  - `role_id` (FK -> roles)
  - `department_id` (FK - Optional)
  - `venue_id` (FK - Optional)

### 2.2 Task Management
- **`tasks`**:
  - `task_id` (PK)
  - `title`, `description`, `category`, `priority`
  - `score`, `penalty_per_hour`
  - `is_escalate` (Boolean)
  - `is_package` (Boolean - for multipart closure types)
  - `creator_id`, `approver_id`, `faculty_id`
- **`task_types`**:
  - `task_id` (FK -> tasks)
  - `task_name` (Fixed, Long, Recurring, Subscription, etc.)
  - `start_date`, `end_date`
  - `start_time`, `end_time`
  - `recurrence` (none, daily, weekly, monthly)
- **`task_assign`**:
  - `task_id`, `user_id` (Composite PK)
  - `status` (pending, accepted, rejected, completed, escalated)
  - `proof` (URL to image/doc)
  - `reason` (Rejection text)
  - `submitted_time`

### 2.3 Compliance & Logging
- **`task_acknowledgments`**:
  - `user_id`, `date`
  - `acknowledged_at`
- **`task_escalations`**:
  - `task_id`, `creator_id`, `rejected_user_id`
  - `escalated_to` (Supervisor ID)
  - `reason` (Unacknowledged, Unaccepted, Overdue)
- **`task_logs`**:
  - Detailed audit trail: `user_id`, `action` (create/accept/close), `timestamp`.

---

## 3. Global Constants & Calculation Logic

### 3.1 The Acknowledgment Window
- **Start**: `06:30 AM`
- **Hard Deadline**: `08:45 AM`
- **Behavior**: If a user has a task today but no ack record by 08:45, all today's tasks move to `escalated`.

### 3.2 The "7 PM Transition" (Tomorrow Preview)
- **Trigger**: `currentTime >= 19:00:00 (IST)`
- **Behavior**:
  - The "Pending/Upcoming" UI lists tasks for `Date.today()` before 7 PM.
  - Lists tasks for `Date.tomorrow()` after 7 PM.
  - Encourages pre-acceptance (Planning Phase).

### 3.3 Scoring & Penalty Formulas
- **Net Score**: `Total_Earned - Total_Redeemed`.
- **Completion Scoring**: 
  - `Score_Awarded = task.score * (1.0)` if submitted on time.
  - No score if over 24 hours late.
- **Penalty Calculation**:
  - `Hours_Late = (Actual_Completion - Target_End_Time)`.
  - `Penalty = Hours_Late * task.penalty_per_hour`.

---

## 4. API Endpoint Map (Page-by-Page)

### 4.1 Authentication & Profile
- `POST /api/auth/login`: Authentication and context initialization.
- `GET /api/users/profile`: Fetches base user + specific profile (Student/Faculty).
- `GET /api/users/:id/activity`: Unified activity log for profile pages.

### 4.2 The Dashboard Ecosystem
- **Student Dashboard**: `GET /api/users/dashboard/student`
  - Returns: `todays_tasks`, `stats`, `overall_score`, `escalation_count`.
- **Faculty Dashboard**: `GET /api/users/faculty/stats/daily`
  - Returns: Mentee stats, tasks awaiting HOD approval, own schedule.
- **HOD Dashboard**: `GET /api/users/dashboard/Departmental`
  - Returns: Total students/faculty, Top 3 performers, Escalated task stream.
- **Principal Dashboard**: `GET /api/users/dashboard/Institutional`
  - Returns: Institution-wide counts, Budget/Point monitoring, High-level escalations.

### 4.3 Task Actions (Execution Phase)
- **Accept Task**: `POST /api/tasks/:id/accept`
- **Reject Task**: `POST /api/tasks/:id/reject`
- **Transfer Task**: `POST /api/tasks/:id/transfer` (Moves task to another user if allowed).
- **Submit Proof**: `POST /api/tasks/:id/submit-proof` (Uploads doc/image).
- **Acknowledge**: `POST /api/tasks/acknowledge-general` (Registers presence).

---

## 5. The Escalation & Notification Engine (Deep Dive)

### 5.1 Escalation Logic (`jobs/task-escalation.js`)
The engine is multi-stage, ensuring accountability at every step:

**Stage 1: Acknowledgment Check (08:45 AM)**
- Query: `SELECT roles FROM users WHERE has_tasks_today = true`.
- Logic: If `userId` not in `task_acknowledgments` for today, escalate.
- Target: Supervisor (Faculty/HOD).

**Stage 2: Acceptance Check (Real-time at Task Start)**
- Trigger: Every minute via Cron.
- Logic: If `now() > task.start_time` AND `assign.status == 'pending'`, escalate.
- Notification: "Attention: Task X has started but was not accepted/delegated."

**Stage 3: Closure Check (Real-time at Task End + Buffer)**
- Trigger: Every minute via Cron.
- Logic: If `now() > task.end_time + 1 Hour` AND `assign.status != 'completed'`, escalate.
- Target: Supervisor + Notification to Assignee: "Task X is overdue. Escalation record created."

### 5.2 Notification Logic (`jobs/task-notifications.js`)
State-based reminders to keep users engaged:
- **T-10 Minutes**: "Task [Title] starts in 10 minutes at [Venue]."
- **OTP Pulse (During Task)**: Every 30 mins, notifies Creator: "Progress: 12/20 students have verified OTP."
- **Daily Recap (21:00)**: "Your Daily Audit: 95% Tasks Completed, 5 Escalations today."

---

## 6. Bulk Operations (CRUD & Import)

### 6.1 Venue Incharge CRUD
- **Create Venue**: `POST /api/resource/venues` (Admin).
- **Assign Incharge**: `PUT /api/resource/venues/:id/incharge`.
- **Logic**: Automatically creates a `RoleAssignment` and a `RoleUser` profile if it doesn't exist, ensuring the user can immediately access the Incharge Dashboard.

### 6.2 Excel Bulk Uploads
- **User Import (`/api/users/bulk/students`)**:
  - Fields: `reg_no`, `name`, `email`, `department_name`, `year`.
  - Auto-Action: Validates Department Name existence; generates hashed password; creates AuthAccount.
- **Task Title Master (`/api/tasks/titles/bulk`)**:
  - Fields: `task_title`, `target_role`.
  - Logic: Prevents duplicate titles; maps titles to role filters (e.g., student-only titles).
- **Bulk Assign (`/api/tasks/:id/assign/bulk`)**:
  - Fields: `email` or `reg_no`.
  - Logic: Validates if thousands of users can be assigned at once; checks `canAssignTo` permissions for each row.

---

## 7. Security & Compliance Rules

### 7.1 OTP Verification
- **Generation**: `POST /api/tasks/otp/generate` (Only by Creator).
- **Verification**: `POST /api/tasks/otp/verify`.
- **Volatility**: Code expires in 20 seconds. If a student misses the window, the Creator must refresh the dashboard to get a new code.

### 7.2 Conflict Prevention
- **Blocking**: No user can `accept` a task that overlaps with an already `accepted` task.
- **Long Task Lock**: If a user is on a "Long Task" (Full day), the system throws a `412` for ANY other task acceptance on that day.
- **Transfer Restriction**: A task cannot be transferred to a user who is already busy or on leave.

---

## 8. Summary Table of Page-to-API Mappings

| UI Screen | User Type | Primary API | Logic Note |
| :--- | :--- | :--- | :--- |
| **Attendance Log** | All | `/api/tasks/acknowledgments` | Shows daily ack history. |
| **All Escalations** | Faculty/HOD | `/api/tasks/escalations/me` | Shows failures of subordinates. |
| **Venue Heatmap** | Incharge | `/api/tasks/venue-dashboard` | Usage calculation: minutes used / 720. |
| **Point Market** | Student | `/api/coupons/available` | Filters out already redeemed items. |
| **Approval Gate** | Principal | `/api/tasks/approval-requests/pending` | Tasks needing institutional sign-off. |
| **Self Log History**| Student | `/api/tasks/created-by/:userId` | Filtered for category: 'Self Log'. |

---

## 9. Final Developer Notes
The backend is built using **Node.js, Sequelize, and Express**. 
- Always check the `middlewares/auth.middleware.js` for role-based gating.
- Cron jobs are initialized in `app.js` and defined in the `jobs/` folder.
- Time management is strictly **IST (GMT+5:30)**; use the helper `toDateStr` for date formatting.
