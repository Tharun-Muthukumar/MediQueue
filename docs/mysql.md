# MySQL setup

MediQueue stores everything in **MySQL 8** (MariaDB 10.6+ also works). You set this up once.

## 1. Install MySQL

Windows: install **MySQL Community Server 8** (with MySQL Workbench) from <https://dev.mysql.com/downloads/installer/>.
Remember the **root password** you choose; keep the default port **3306**.

Check that it is running:

```powershell
mysql --version
mysql -u root -p          # type your root password; you get a mysql> prompt
```

If `mysql` is not recognized, either use MySQL Workbench / "MySQL 8.0 Command Line Client" from the Start menu,
or add `C:\Program Files\MySQL\MySQL Server 8.0\bin` to PATH.

## 2. Create the database and the app's account

Run these as root (in the `mysql>` prompt or a Workbench query tab):

```sql
CREATE DATABASE IF NOT EXISTS mediqueue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'mediqueue'@'localhost' IDENTIFIED BY 'mediqueue123';
GRANT ALL PRIVILEGES ON `mediqueue%`.* TO 'mediqueue'@'localhost';
FLUSH PRIVILEGES;
```

`mediqueue%` covers `mediqueue` plus the throwaway databases the tests create (`mediqueue_test`, `mediqueue_e2e`, `mediqueue_bench`).

The app connects with this line in `backend/.env` (setup creates it for you):

```
DATABASE_URL="mysql://mediqueue:mediqueue123@localhost:3306/mediqueue"
```

Prefer to use root? Put `mysql://root:YOUR_ROOT_PASSWORD@localhost:3306/mediqueue` there instead.
If the password contains `@ : / # ?`, write them as `%40 %3A %2F %23 %3F`.

## 3. Create the tables and demo data

Pick **one** way.

### A. Let the app do it (recommended)

```powershell
cd D:\cad\mediqueue
npm run setup        # installs packages, creates the 13 tables, loads demo data dated today
npm run dev          # http://localhost:5173
```

`npm run reset` reloads fresh demo data for today at any time (it wipes the data in `mediqueue`).

### B. Paste or import the one SQL file

`database/mediqueue_mysql.sql` does everything in one go: creates the database and the `mediqueue`
account, all 13 tables, and the dummy records (17 accounts, 3 doctors, about 880 slots, a week of
past visits, today's queue and two weeks of bookings). Steps 2 and 3 are both inside it.

- **Workbench:** connect as root, then File → Open SQL Script → Execute all (⚡). Or paste the whole file into a query tab and Execute all.
- **Command line:** `mysql -u root -p < D:\cad\mediqueue\database\mediqueue_mysql.sql`

All dates are worked out when you run it, so "today" in the app is always your real today.
It drops any existing `mediqueue` database first. Run it again any time to reset the demo.
Then start the app with `npm run dev`. If you never ran `npm run setup`, run it once first so the
packages get installed; that also reloads the same demo data.

## 4. Sign in

| Role | Email | Password |
|---|---|---|
| Admin | `admin@gmail.com` | `admin123` |
| Reception | `reception@gmail.com` | `reception123` |
| Doctor | `doctor1@gmail.com` (also `doctor2`, `doctor3`) | `doctor123` |
| Patient | `patient1@gmail.com` … `patient12@gmail.com` | `patient123` |

These are demo accounts that exist only in your local database. The app never sends email.

## Useful MySQL commands

```sql
USE mediqueue;
SHOW TABLES;
DESCRIBE User;

-- accounts
SELECT name, email, role, isActive FROM User ORDER BY role, name;

-- doctors
SELECT d.code, u.name, d.department, d.room, d.avgMinutes, d.status
FROM Doctor d JOIN User u ON u.id = d.userId ORDER BY d.code;

-- today's queue (change the date)
SELECT t.tokenLabel, u.name AS patient, t.source, t.status, t.checkedInAt, t.calledAt
FROM QueueTicket t JOIN User u ON u.id = t.patientId
WHERE t.serviceDate = '2026-10-21' ORDER BY t.tokenLabel;

-- today's appointments
SELECT s.startAt, u.name AS patient, a.status
FROM Appointment a JOIN Slot s ON s.id = a.slotId JOIN User u ON u.id = a.patientId
WHERE a.serviceDate = '2026-10-21' ORDER BY s.startAt;

-- free slots for one doctor on one day
SELECT s.startAt, s.capacity - s.reservedCount AS free
FROM Slot s JOIN Doctor d ON d.id = s.doctorId
WHERE d.code = 'D02' AND s.serviceDate = '2026-10-22' ORDER BY s.startAt;

-- average visit length per doctor
SELECT d.code, ROUND(AVG(c.durationSec) / 60, 1) AS avg_minutes, COUNT(*) AS visits
FROM Consultation c JOIN Doctor d ON d.id = c.doctorId
WHERE c.durationSec IS NOT NULL GROUP BY d.code;

-- latest audit entries
SELECT at, actorRole, action, entityType, reason FROM AuditEvent ORDER BY at DESC LIMIT 20;

-- row counts
SELECT table_name, table_rows FROM information_schema.tables WHERE table_schema = 'mediqueue';
```

Times are stored in **UTC** (`DATETIME(3)`); the app shows them in India time (UTC+05:30).
To read them in India time in SQL: `CONVERT_TZ(startAt, '+00:00', '+05:30')`.

Passwords are stored only as bcrypt hashes. Don't type new passwords into SQL. Use the app instead:
**My profile → Password**, **People → Add staff member**, or the register page.

### Start over

```sql
DROP DATABASE mediqueue;
CREATE DATABASE mediqueue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

then `cd backend` and `npx prisma migrate deploy`, then `npm run db:seed`. Or re-import the SQL file.

## Troubleshooting

| Message | Fix |
|---|---|
| `Can't reach database server at localhost:3306` | MySQL isn't running. Windows: Services → **MySQL80** → Start |
| `Authentication failed` / `Access denied for user` | Wrong user or password in `backend/.env`, or step 2 not run |
| `User was denied access on the database` | Run the `GRANT` line from step 2 again |
| `Unknown database 'mediqueue'` | Run the `CREATE DATABASE` line, or `npm run setup` |
| Port 3306 used by something else | Change the port in MySQL and in `DATABASE_URL` |

## Tables

| Table | What it holds |
|---|---|
| `Clinic` | Clinic name, time zone and queue policy (2:1 ratio, grace and late minutes) |
| `User` | Every account (patient, receptionist, doctor, admin), bcrypt password hash, optional photo |
| `Session` | Signed-in sessions (only a SHA-256 of the cookie token is stored) |
| `Doctor` | Doctor profile: code (D01), department, room, default visit length, status |
| `Slot` | Bookable time slots with capacity and reserved count |
| `Appointment` | Bookings and their status (booked, checked in, cancelled, no-show, completed) |
| `QueueCounter` | Last token number per doctor per day |
| `DoctorQueueState` | Pause state and 2:1 rotation state per doctor per day |
| `QueueTicket` | Tokens issued at check-in, their status and timestamps |
| `Consultation` | Start/end of each visit, used for wait-time estimates |
| `Notification` | In-app messages to patients |
| `AuditEvent` | Who did what, when, why, with before/after values |
| `IdempotencyRecord` | Stops a double-clicked booking from booking twice |
