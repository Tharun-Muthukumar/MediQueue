# MediQueue

**Intelligent clinic appointment, token queue and waiting-time management** — a local-first CAD project.

A patient knows when to come, a receptionist knows who has arrived, a doctor knows whom to call next, and the clinic administrator can prove how well the waiting room is working.

> Student engineering prototype. All people, doctors and records are fictional. Not a medical device, not an EMR, not for emergencies — MediQueue never infers clinical urgency.

---

## What's inside

| Area | What it does |
|---|---|
| **Four roles** | Patient, Receptionist, Doctor, Admin — enforced on every API route, not just hidden in the UI |
| **Atomic booking** | Conditional `reservedCount < capacity` update inside one transaction + `Idempotency-Key` replay. 50 simultaneous requests for one slot → exactly 1 succeeds |
| **Token queue** | Token issued only at check-in, from a per-doctor/day counter in the same transaction (`D01-004`). Unique constraints make duplicates impossible |
| **Fair, explainable order** | 2 booked : 1 walk-in (configurable), each group in time order; persisted selector state; atomic "call next" |
| **Honest ETA** | Rolling median of the doctor's last 5–15 visits + time left on the current visit + time until the session opens; shown as a range; "unavailable" while paused |
| **Live updates** | Server-Sent Events push "something changed" hints; screens refetch instantly. Falls back to 5-second polling |
| **Operations** | Late-arrival override with reason, no-show grace period (+ optional auto job), mark absent / return to queue, doctor pause/resume |
| **Admin** | Metrics dashboard with charts, per-doctor table, daily CSV (formula-injection safe, no patient names), audit log with before/after, slot generator, staff management, clinic policy |
| **Profiles & dashboards** | Every role has a dashboard with a welcome banner, icon stat cards with 7-day sparklines, avatars for every patient and doctor, and a "My profile" page: upload or remove a photo (cropped and compressed in the browser), edit name and phone, change password (signs out other devices) |
| **Waiting-room board** | Full-screen TV view at `/board` — token numbers and rooms only, no names |
| **Experience** | Cursor-following ring and spotlight, 3D tilt on tokens and the live board, magnetic buttons, scroll reveals, page transitions, count-up metrics, loading bar, `Ctrl/⌘ + K` command palette, doctor keyboard shortcuts (N/S/C/P), "your turn" chime + vibration + tab flash + optional desktop notification, board flip animation and chime. All motion switches off for touch devices and "reduce motion" users |
| **Evidence** | 64 automated backend tests, 10 Playwright browser tests covering every module and role, ETA accuracy evaluation, latency/contention benchmark |

**Stack:** React 19 + Vite + TypeScript, Tailwind CSS v4, TanStack Query, React Hook Form + Zod, Recharts, Lucide · Node.js + Express 5 + TypeScript, Prisma 6 + MySQL 8, bcryptjs, Helmet, rate limits, CSRF double-submit · Vitest + Supertest + Playwright.

---

## Quick start (Windows)

1. Install **Node.js 22 LTS** from <https://nodejs.org> (tick "Add to PATH"). Reopen any terminals afterwards.
2. Install **MySQL 8** and run the four lines below once as root (MySQL Workbench or `mysql -u root -p`). Full guide: [`docs/mysql.md`](docs/mysql.md).
   ```sql
   CREATE DATABASE IF NOT EXISTS mediqueue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER IF NOT EXISTS 'mediqueue'@'localhost' IDENTIFIED BY 'mediqueue123';
   GRANT ALL PRIVILEGES ON `mediqueue%`.* TO 'mediqueue'@'localhost';
   FLUSH PRIVILEGES;
   ```
3. Double-click **`setup-windows.bat`**. It installs everything, creates the 13 MySQL tables and loads demo data (a few minutes the first time).
4. Double-click **`start-windows.bat`** — starts the API and website and opens <http://localhost:5173>.

### Or with PowerShell / any terminal

```powershell
cd D:\cad\mediqueue
npm run setup        # once: install, create backend\.env, create MySQL tables, load demo data
npm run dev          # API on :4000 + website on :5173 (Ctrl+C to stop)
```

Open **http://localhost:5173** and use the one-click demo buttons on the sign-in page.

### Demo accounts (local only)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@gmail.com` | `admin123` |
| Receptionist | `reception@gmail.com` | `reception123` |
| Doctor (Dr. Maya Iyer, D01) | `doctor1@gmail.com` | `doctor123` |
| Doctor (Dr. Arjun Rao, D02 / Dr. Neha Shah, D03) | `doctor2@gmail.com`, `doctor3@gmail.com` | `doctor123` |
| Patient (Aarav Menon, token D01-004 today) | `patient1@gmail.com` | `patient123` |
| Other patients | `patient2@gmail.com` … `patient12@gmail.com` | `patient123` |

These accounts exist only in your local database; the app never sends email.

The seed is relative to **today**: 7 days of simulated history, today's Appendix B.2 queue for Dr. Maya Iyer (D01-001 done, D01-002 with the doctor, D01-003 walk-in, D01-004 Aarav, D01-005 walk-in), bookings waiting for reception, and two weeks of future slots.

---

## All commands

Run from the project root unless noted.

| Command | What it does |
|---|---|
| `npm run setup` | First-time install + `.env` + database + demo data |
| `npm run dev` | Development mode: API (`:4000`, auto-reload) + Vite (`:5173`) |
| `npm start` | Builds both and serves the whole app from **one** process on <http://localhost:4000> |
| `npm run reset` | Restores the demo data (wipes local data, re-seeds relative to now) |
| `npm test` | 64 backend unit + API integration tests (uses a separate `mediqueue_test` database) |
| `npm run test:e2e` | 10 Playwright browser tests: every module, every role, profile, mobile, keyboard, motion settings (first run `npx playwright install chromium`) |
| `npm run eval:eta` | RQ2 — ETA accuracy vs fixed baseline → `docs/results/eta-evaluation.md` |
| `npm run bench` | RQ1/RQ4 — API latency + 50-way slot contention → `docs/results/benchmark.md` |
| `npm run typecheck` | TypeScript checks for backend and frontend |
| `cd backend && npx prisma studio` | Browse the MySQL database in a GUI (or use MySQL Workbench) |

Health check: <http://localhost:4000/api/v1/health>

---

## Nine-minute demo script

| Time | Do this | Shows |
|---|---|---|
| 0:00 | Open the landing page — the hero is the live waiting-room board. Explain the problem and `docs/architecture.md` | Problem, design |
| 0:45 | Sign in as **Admin** → Overview charts, Doctors & schedules → Calendar | RBAC, scheduling |
| 1:45 | Two browsers (one private window): `patient2` and `patient3` both open Dr. Neha Shah on the same day, pick the **same** time, press *Book this time* together → one succeeds, the other sees "Someone just took that slot" | Transactions, concurrency |
| 3:00 | **Reception** → Arrivals → *Check in* (late patients ask for a reason) → token slip; *Register walk-in* | Atomic token issuance |
| 4:15 | **Doctor** (doctor1) → *Complete visit* → *Call next patient* (a walk-in, because two booked patients were just served) → *Start visit* → *Complete* | Queue state machine, 2:1 policy |
| 5:30 | Keep **patient1** open: the ETA drops as visits finish; then "It's your turn". Doctor *Pause queue* → patient sees "Waiting time unavailable"; *Resume* | Live ETA, events |
| 6:40 | As patient, open `/admin` → bounced back. Run `npm test` and show the passing role/ownership tests | Authorization |
| 7:30 | Admin → Overview metrics + *Daily CSV*; Audit log filtered by "Queue called" | Analytics, audit |
| 8:30 | `infrastructure/README.md` — AWS migration plan and cost guardrails | Deployment readiness |

---

## Handy shortcuts

| Where | Keys | Action |
|---|---|---|
| Anywhere after sign-in | `Ctrl + K` (`⌘ + K` on Mac) | Jump to any page or action |
| Doctor console | `N` / `S` / `C` / `P` | Call next / start visit / complete visit / pause or resume |
| Every dialog | `Esc` | Close and return focus |
| Waiting-room board | speaker icon | Chime whenever a new token is called |

## Project structure

```
mediqueue/
├─ backend/                    Express + Prisma API
│  ├─ prisma/                  schema.prisma (MySQL), migrations/, seed.ts
│  ├─ src/
│  │  ├─ domain/               pure rules: queuePolicy, eta, stateMachine, simulation
│  │  ├─ services/             business workflows (booking, reception, queue, admin…)
│  │  ├─ repositories/         storage contracts (interfaces) — no Prisma here
│  │  ├─ adapters/mysql/       Prisma + MySQL implementation of the contracts
│  │  ├─ routes/               HTTP: validation (Zod), auth guards, responses
│  │  ├─ auth/                 sessions, role guards, CSRF
│  │  ├─ events/               in-process event bus → Server-Sent Events
│  │  ├─ jobs/                 no-show sweep, cleanup
│  │  └─ shared/               errors, time zones, CSV, utilities
│  ├─ tests/                   Vitest + Supertest (64 tests)
│  └─ scripts/                 eval-eta.ts, bench.ts, db.ts (create/recreate databases)
├─ frontend/                   React + Vite SPA
│  └─ src/{app,components,pages,lib,styles}
├─ database/                   mediqueue_mysql.sql (database + user + tables + dummy data, one file), schema.sql (tables only)
├─ e2e/                        Playwright cross-role tests
├─ docs/                       architecture, API, testing, results
├─ infrastructure/README.md    future AWS plan (nothing is deployed)
├─ setup-windows.bat / start-windows.bat
└─ package.json                root scripts
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm` / `node` not recognized | Install Node.js 22 LTS, then close and reopen the terminal / VS Code |
| `EADDRINUSE :4000` or `:5173` | Another copy is running. Close the other terminal, or in PowerShell: `Get-Process node \| Stop-Process` |
| Website says "Cannot reach the MediQueue server" | The API isn't running — start with `npm run dev` (both run together) |
| Prisma engine download fails during setup | Check internet/proxy, then run `cd backend; npx prisma generate` again |
| `Prisma Client did not initialize` | `cd backend; npx prisma generate` |
| No slots visible for today | It's past the doctor's hours, or Sunday. Pick another day, or run `npm run reset` to re-seed relative to now |
| Stale demo after a few days | `npm run reset` — the demo day is always "today" after re-seeding |
| `401` on everything after changing `.env` | The session secret changed; sign in again |
| Playwright says browser missing | `npx playwright install chromium` |
| `Can't reach database server at localhost:3306` | MySQL isn't running: Windows Services → **MySQL80** → Start |
| `Access denied for user 'mediqueue'` | Run the MySQL commands in Quick start step 2, or fix `DATABASE_URL` in `backend\.env` |

---

## Privacy & safety

- Synthetic data only. Passwords are bcrypt-hashed; sessions are opaque random tokens stored hashed (SHA-256) server-side, sent as a signed **HttpOnly, SameSite=Lax** cookie; state-changing requests need the CSRF double-submit header.
- Patients only ever receive their own records (others → 404, not 403, so existence isn't leaked). The public board and CSV exports carry no patient names.
- Login rate limiting, Helmet security headers (CSP), 256 KB body limit (room for a small profile photo), generic 500 messages with a `requestId` (stack traces stay in the server log).
- Every booking, cancellation, check-in, call, start, completion, pause, override and setting change is audited with actor, time, before/after and reason.

## Documentation

- [`docs/mysql.md`](docs/mysql.md) — MySQL setup, all commands, useful queries, table list
- [`docs/architecture.md`](docs/architecture.md) — layers, data model, algorithms, sequence diagrams
- [`docs/api.md`](docs/api.md) — full REST catalogue and error codes
- [`docs/testing.md`](docs/testing.md) — test catalogue T01–T30 mapped to automated tests
- [`docs/results/`](docs/results) — ETA evaluation and benchmark output
- [`infrastructure/README.md`](infrastructure/README.md) — future AWS serverless migration (not deployed)
