# Testing

```powershell
npm test               # 64 backend tests (Vitest + Supertest, real MySQL transactions, ~25 s)
npm run test:e2e       # 10 Playwright browser tests, every module and role (first: npx playwright install chromium)
npm run eval:eta       # RQ2 evaluation → docs/results/eta-evaluation.md
npm run bench          # RQ1/RQ4 benchmark → docs/results/benchmark.md
```

Backend tests run against a separate MySQL database, `mediqueue_test` (your database name + `_test`), dropped and recreated from the migrations at the start of every run, with a controllable clock (`ManualClock`) so time-based rules (late arrival, grace period, ETA) are deterministic.

## Blueprint acceptance catalogue → automated tests

| ID | Scenario | Where | Result |
|---|---|---|---|
| T01 | Registration creates PATIENT only | `auth.test.ts` "registration always creates a PATIENT" | ✅ |
| T02 | Wrong password → 401, no leak | `auth.test.ts` "wrong password returns 401" | ✅ |
| T03 | Patient calls admin API → 403, nothing changes | `auth.test.ts` "T03" | ✅ |
| T04 | Patient reads another's appointment → 404 | `booking.test.ts` "T04/T11" | ✅ |
| T05 | No slots on a date → empty | `booking.test.ts` "T05" | ✅ |
| T06 | Book free slot → 201, reservedCount 1 | `booking.test.ts` "T06" | ✅ |
| T07 | Two simultaneous requests for last slot → one 201, one 409 | `booking.test.ts` "T07" (+ 20-way "RQ1 contention") | ✅ |
| T08 | Same Idempotency-Key + body → same result | `booking.test.ts` "T08" (parallel + sequential replay) | ✅ |
| T09 | Same key, different body → 409 | `booking.test.ts` "T09" | ✅ |
| T10 | Cancel own future booking → capacity released once | `booking.test.ts` "T10" (two parallel cancels) | ✅ |
| T11 | Cancel another patient's booking → denied | `booking.test.ts` "T04/T11" | ✅ |
| T12 | Check-in issues unique WAITING ticket | `queue.test.ts` "T12" | ✅ |
| T13 | Same appointment checked in twice → no second token | `queue.test.ts` "T13" (parallel) | ✅ |
| T14 | Concurrent check-ins → serial unique tokens | `queue.test.ts` "T14" (6 parallel) | ✅ |
| T15 | Walk-in → WALK_IN ticket | `queue.test.ts` "T15" | ✅ |
| T16 | Call next + start → CALLED → IN_CONSULTATION | `queue.test.ts` "T16/T18" | ✅ |
| T17 | Simultaneous call-next → at most one CALLED | `queue.test.ts` "T17" (3 parallel) | ✅ |
| T18 | Complete → duration stored, ticket & appointment completed | `queue.test.ts` "T16/T18" | ✅ |
| T19 | Pause → call-next rejected, ETA paused | `queue.test.ts` "T19/T20" | ✅ |
| T20 | Resume → call-next allowed | `queue.test.ts` "T19/T20" | ✅ |
| T21 | No-show after grace period | `queue.test.ts` "T21" + "automatic sweep" | ✅ |
| T22 | 2:1 ordering | `domain.test.ts` "T22" (pure) + `queue.test.ts` "T22" (through the API) | ✅ |
| T23 | ETA recomputes predictably after completion | `queue.test.ts` "T23" (exact second values) | ✅ |
| T24 | Clinic timezone across midnight UTC | `domain.test.ts` "T24" | ✅ |
| T25 | Admin CSV: headers, synthetic only | `admin.test.ts` "T25" | ✅ |
| T26 | Patient report export → forbidden | `admin.test.ts` "T26" | ✅ |
| T27 | Invalid date/payload → 400 structured | `booking.test.ts` "T27" | ✅ |
| T28 | Backend restart keeps queue consistent | `queue.test.ts` "T28" (new store + app on same DB) | ✅ |
| T29 | Keyboard-only navigation | Manual checklist below + Playwright drives every flow by accessible role/label | ✅ manual |
| T30 | XSS-looking name → escaped text | `auth.test.ts` "T30" (API stores raw text; React escapes on render) | ✅ |

Additional automated checks: CSRF and foreign-Origin rejection, server-side session invalidation on logout and deactivation, full role matrix, late check-in override, wrong-day check-in, requeue/skip reasons audited, slot generator overlap/past skipping, deactivated doctor not bookable, settings validation + audit, public board anonymity, notification ownership, CSV formula-injection sanitiser, simulator determinism and causality.

## T29 keyboard checklist (manual)

1. `Tab` from the address bar: "Skip to content" appears first, then sidebar links, notification bell, sign-out.
2. Sign-in form is fully operable with `Tab` / `Enter`; validation errors are announced (`role="alert"`).
3. Booking: department chips, doctor list, day strip and time buttons all receive visible focus rings; `Enter` opens the confirm dialog.
4. Dialogs move focus inside, trap `Tab`, close with `Esc`, and return focus to the button that opened them.
5. Status is always text + colour (e.g. "Waiting", "With doctor"), never colour alone.
6. `prefers-reduced-motion` disables animations.

## Module sweep (`e2e/modules.spec.ts`)

| Test | What it clicks through |
|---|---|
| Authentication | Form validation, wrong password message, protected-route redirect, sign-out, password-mismatch on register, 404 page |
| Admin | Add doctor (with validation) → sign in as the new doctor; generate slots twice (second run creates 0 — overlap guard); calendar + delete slot; edit; deactivate/reactivate; add staff, deactivate (sign-in refused), reactivate; clinic policy validation + save + revert; audit filters; report date change + CSV download |
| Reception | Check-in (handles late-arrival reason), search + status filters, no-show with reason, cancel (reason required), walk-in for an existing patient, mark absent → return to queue, call next for a doctor |
| Doctor | Called by mistake (reason), patient not here (reason), call → start → complete, pause (reason required) → board shows "Paused" → resume |
| Patient | Notification panel + mark all read, appointment tabs, live-token empty state |
| Mobile & keyboard | No horizontal overflow at 390 px, drawer navigation, page title, skip link first in tab order, dialogs open with Enter / close with Esc / return focus |
| Experience layer | Ctrl+K palette navigation, doctor shortcuts N/S/C, cursor follower appears for mouse users, nothing animated with "reduce motion" |
| Profile | Account menu → My profile, save name and phone (banner updates), upload a photo then remove it, wrong current password refused, real password change, sign in with the new password |

Every test also asserts there were **no browser console errors**. The suite passed three consecutive runs.

### Bugs this sweep found and fixed

1. Dialogs re-ran their focus logic on every live update, which could move the cursor to the first field while someone was typing (lost edits in "Edit doctor").
2. Admin forms could load their values just after the dialog appeared, overwriting very early typing.
3. After signing in, keyboard focus was stranded; focus now returns to the top of the page and each page sets its own browser-tab title.
4. Paused-queue banner grammar on the doctor console.
5. Buttons nested inside links (invalid HTML for screen readers) replaced by proper link-buttons.
6. Landing page header overflowed on 390 px phones.
7. Profile photo upload was blocked by the app's own Content-Security-Policy (images from `blob:` URLs are not allowed). The photo is now read as a `data:` URL, which the policy permits.
8. Wide admin tables pushed the whole page sideways on phones; grid columns now let tables scroll inside their card.

## Browser tests (Playwright)

`e2e/happy-path.spec.ts` starts an isolated server on port 4100 with its own freshly seeded MySQL database, `mediqueue_e2e`:

1. Patient sees token D01-004 and "1 person ahead of you".
2. Doctor completes D01-002, calls next → **D01-003 (walk-in, by the 2:1 rule)**, starts, completes, calls → D01-004.
3. Patient's open page switches to "It's your turn" **without reloading** (Server-Sent Events).
4. Reception registers a walk-in for Dr. Arjun Rao → token D02-002 dialog.
5. Admin overview shows 3 completed visits and downloads the daily CSV.
6. Patient navigating to `/admin` is redirected back.
7. A newly registered patient books a future slot and cancels it.
