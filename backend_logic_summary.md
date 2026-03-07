# Backend Logic Summary: Task Management & Escalation Engine

This document provides a technical overview of the backend architecture, scheduling logic, and compliance systems implemented in the Task App. It is intended for developers who wish to understand or maintain the system.

## 1. Core Concepts & Entities
- **Tasks (`Task`)**: The central entity representing a piece of work. It contains metadata like priority, category, and approval status.
- **Task Types (`TaskType`)**: Defines the *schedule* of a task (start/end date, start/end time).
- **Assignments (`TaskAssign`)**: Links a task to a user. Tracks the `status` (pending, accepted, in_progress, completed, frozen, escalated).
- **Escalations (`TaskEscalation`)**: Formal records created when a user fails to comply with task rules, routing the failure to a supervisor.

---

## 2. Scheduling & Visibility Logic

### The 7:00 PM "Tomorrow" Transition
To help users plan ahead, all dashboards transition to "Tomorrow Mode" at **7:00 PM (19:00 IST)**.
- **Logic**: If `current_hour >= 19`, `effective_today = tomorrow`.
- **Today's Schedule**: Displays tasks for the next day after 7 PM.
- **Pending Approvals**: Allows users to accept tasks starting the next day.
- **Implementation**: Handled globally in `user.dashboard.js` and `user.controller.js` (Faculty stats).

### Daily Acknowledgement Window (6:30 AM - 8:45 AM)
Users must acknowledge their presence/availability for the day's tasks.
- **Mechanism**: A flag `needs_acknowledgement: true` is sent to the frontend during this window.
- **Action**: Users call `/api/tasks/acknowledge` to create a `TaskAcknowledgment` record.
- **Consequence**: Failing to acknowledge by 8:45 AM triggers an automatic escalation of all of that day's tasks.

---

## 3. Long Task Logic
"Long Tasks" represent work that occupies an entire day or multiple days (e.g., workshops, events).
- **Identification**: Based on `task_name` ("Long Task" or "Date-Only / Long Task").
- **Unified Timing**: Always displayed as **08:45 - 16:30** for consistency.
- **Conflict Prevention**: 
    - When a user accepts a task, the system checks for overlaps.
    - If a Long Task is involved, it blocks the **entire date range**, preventing any other task from being accepted on those days.
- **Implementation**: Logic primary resides in `task.acceptance.js` and timing overrides in dashboard/calendar controllers.

---

## 4. Escalation Engine
The Escalation Engine (`jobs/task-escalation.js`) enforces accountability through three main triggers:

| Trigger | Timing | Description |
| :--- | :--- | :--- |
| **Unacknowledged** | 08:45 AM | Tasks not acknowledged by the morning deadline. |
| **Unaccepted** | Task Start Time | Tasks still in `pending` status when they are supposed to start. |
| **Overdue** | End Time + 1 Hr | Tasks not `completed` within one hour of their deadline. |

### Hierarchy-Based Routing
Escalations are not sent to the system admin; they follow the institutional hierarchy:
1. **Student** → Assigned Faculty (Mentor)
2. **Staff** → Manager / In-charge
3. **Faculty / In-charge** → HOD (Department-specific)
4. **HOD** → Principal

*Logic resides in `utils/hierarchy.js` using `getSupervisor(userId)`.*

---

## 5. Critical API Endpoints

- `PATCH /api/tasks/accept/:id`: Updates status to `accepted`. Includes the multi-day conflict check.
- `POST /api/tasks/acknowledge`: Marks the user as "Present" for the day's tasks.
- `GET /api/users/dashboard/{role}`: Unified dashboards (Student, Staff, HOD, Principal) that handle the 7 PM transition, escalation counts, and schedule filtering.

---

## 6. Automated Jobs (Cron)
- `morning-awareness.js`: Runs at 8:45 AM to catch missing acknowledgements.
- `task-escalation.js`: Runs every 15 minutes to process unaccepted and overdue timeouts.
- `task-notifications.js`: Handles 10-minute reminders and OTP summaries.
