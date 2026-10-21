# REST API — `http://localhost:4000/api/v1`

JSON in and out; timestamps are ISO-8601 UTC. Every request except `GET /health`, `GET /auth/csrf`, `GET /auth/session`, `POST /auth/login`, `POST /auth/register` and the `/public/*` routes needs the session cookie. Every non-GET request needs `X-CSRF-Token` equal to the `mq_csrf` cookie (get one from `GET /auth/csrf`).

Success: `{ "data": … }` · Error: `{ "error": { "code", "message", "requestId", "details?" } }`

## Auth & discovery

| Method & path | Roles | Notes |
|---|---|---|
| `GET /health` | public | `{ status, database }` |
| `GET /auth/csrf` | public | Issues/returns the CSRF token |
| `POST /auth/register` | public | `{ name, email, password, phone? }` → always `PATIENT`; extra fields rejected |
| `POST /auth/login` | public | `{ email, password }` → sets `mq_session`; rotates CSRF token |
| `POST /auth/logout` | any | Deletes the server-side session |
| `GET /auth/me` | signed in | `{ user, doctor?, clinic }` |
| `GET /auth/session` | public | Same as `/me`, or `null` when signed out |
| `GET /departments` | signed in | `[{ name, doctorCount }]` |
| `GET /doctors?department=` | signed in | Active doctors with next free slot |
| `GET /doctors/:id/slots?date=YYYY-MM-DD` | signed in | Slots with `available`, `remaining`, `past` |

## Appointments & reception

| Method & path | Roles | Notes |
|---|---|---|
| `POST /appointments` | PATIENT | Body `{ slotId }`, header `Idempotency-Key` (8–100 chars). `201`, `409 SLOT_FULL / SLOT_UNAVAILABLE / DUPLICATE_BOOKING / DOCTOR_INACTIVE / IDEMPOTENCY_CONFLICT` |
| `GET /appointments/me` | PATIENT | Own history (newest first) |
| `PATCH /appointments/:id/cancel` | PATIENT, RECEPTIONIST, ADMIN | Patients: own, BOOKED, not started. Staff: `{ reason }` required |
| `POST /appointments/:id/check-in` | RECEPTIONIST | `{ overrideReason? }`. `201` new token, `200` already checked in, `422 CHECKIN_WINDOW_CLOSED`, `422 LATE_ARRIVAL_REASON_REQUIRED` |
| `POST /appointments/:id/no-show` | RECEPTIONIST | `{ reason? }`; reason required inside grace period (`422 GRACE_PERIOD_ACTIVE`) |
| `POST /walkins` | RECEPTIONIST | `{ doctorId, patientId }` or `{ doctorId, newPatient: { name, phone? } }` |
| `GET /reception/today?date=` | RECEPTIONIST, ADMIN | Arrivals with flags, counts, per-doctor queues |
| `GET /reception/patients?q=` | RECEPTIONIST | Patient search for walk-ins |

## Queue

| Method & path | Roles | Notes |
|---|---|---|
| `GET /queues/me` | PATIENT | Own tickets today: position, ETA range, now serving (token only) |
| `GET /queues/:doctorId?date=` | DOCTOR (own), RECEPTIONIST, ADMIN | Active visit, waiting list in call order with ETA, stats, estimate basis |
| `POST /queues/:doctorId/call-next` | DOCTOR (own), RECEPTIONIST | Atomic select + call. `409 DOCTOR_PAUSED / CONSULTATION_ACTIVE / NO_PATIENTS_WAITING` |
| `POST /tickets/:id/start` | DOCTOR (own) | CALLED → IN_CONSULTATION |
| `POST /tickets/:id/complete` | DOCTOR (own) | → COMPLETED, stores duration, closes appointment |
| `POST /tickets/:id/requeue` | DOCTOR (own), RECEPTIONIST | `{ reason }`; CALLED/SKIPPED → WAITING |
| `POST /tickets/:id/skip` | DOCTOR (own), RECEPTIONIST | `{ reason }`; WAITING/CALLED → SKIPPED |
| `POST /doctors/:id/pause` | DOCTOR (own), ADMIN | `{ reason }` |
| `POST /doctors/:id/resume` | DOCTOR (own), ADMIN | |

## Notifications & live updates

| Method & path | Roles | Notes |
|---|---|---|
| `GET /notifications` | signed in | `{ unread, items }` (own only) |
| `PATCH /notifications/:id/read` | signed in | Others' ids → 404 |
| `PATCH /notifications/read-all` | signed in | |
| `GET /events` | signed in | Server-Sent Events: `change` events `{ type: queue.changed \| appointments.changed \| notification.created \| doctors.changed, … }` |
| `GET /public/board` | public | Anonymised board: tokens, rooms, doctor names |
| `GET /public/events` | public | SSE hints for the board |

## Admin (`ADMIN` only)

| Method & path | Notes |
|---|---|
| `GET /admin/metrics?date=` | Totals, waits (mean/median/p90), consult times, ETA MAE vs baseline, hourly, 7-day trend, per doctor |
| `GET /admin/reports/daily.csv?date=` | Download; formula-safe; pseudonymous patient reference |
| `GET /admin/audit?action=&entityType=&actorId=&from=&to=&page=&pageSize=` | Paged audit trail |
| `GET /admin/doctors` · `POST /admin/doctors` · `PATCH /admin/doctors/:id` | Roster, create (with sign-in), edit / activate / deactivate |
| `GET /admin/doctors/:id/slots?from=&to=` | Slot calendar |
| `POST /admin/slots/generate` | `{ doctorId, fromDate, toDate, startTime, endTime, slotMinutes, capacity, weekdays[] }` → `{ created, skippedConflicts, skippedPast }` |
| `DELETE /admin/slots/:id` | Only unbooked slots |
| `GET /admin/staff` · `POST /admin/staff` · `PATCH /admin/users/:id/active` | Staff accounts |
| `GET /admin/settings` · `PATCH /admin/settings` | Walk-in ratio, grace, late threshold, auto no-show, default visit length, booking window |

## Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad payload/query; `details` lists fields |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | Not signed in / wrong email or password |
| 403 | `FORBIDDEN`, `CSRF_FAILED`, `ACCOUNT_DISABLED` | Role/ownership/CSRF failure |
| 404 | `NOT_FOUND` | No accessible record (also used to hide others' records) |
| 409 | `SLOT_FULL`, `SLOT_UNAVAILABLE`, `DUPLICATE_BOOKING`, `IDEMPOTENCY_CONFLICT`, `INVALID_STATE`, `DOCTOR_PAUSED`, `DOCTOR_INACTIVE`, `CONSULTATION_ACTIVE`, `NO_PATIENTS_WAITING`, `EMAIL_TAKEN` | Conflicts with current state |
| 422 | `CHECKIN_WINDOW_CLOSED`, `LATE_ARRIVAL_REASON_REQUIRED`, `GRACE_PERIOD_ACTIVE` | Policy needs a different day or a reason |
| 429 | `TOO_MANY_REQUESTS` | Rate limit |
| 500 | `INTERNAL_ERROR` | Sanitised; see server log by `requestId` |

## Example

```http
POST /api/v1/appointments
Cookie: mq_session=…; mq_csrf=…
X-CSRF-Token: …
Idempotency-Key: 8f720d8f-0b42-491a-8f72-2acb6edb8b1e
Content-Type: application/json

{ "slotId": "5b1c…" }
```

```json
201 Created
{ "data": { "appointmentId": "a0e2…", "doctorId": "6c63…", "slotId": "5b1c…", "status": "BOOKED",
            "startAt": "2026-10-23T05:00:00.000Z", "endAt": "2026-10-23T05:15:00.000Z",
            "serviceDate": "2026-10-23", "doctorName": "Dr. Arjun Rao" } }
```
