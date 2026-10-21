import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Module-by-module sweep: every screen and every action button, per role.
 * Runs after happy-path.spec.ts on the same seeded e2e database, so it only relies on
 * data that the earlier spec does not consume (Dr. Arjun Rao D02, Dr. Neha Shah D03, new records).
 */

const clinicDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

async function signIn(browser: Browser, email: string, password: string, viewport?: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}
const errorsOf = (p: Page) => (p as Page & { errors: string[] }).errors;
const dialog = (p: Page) => p.getByRole('dialog');
const toast = (p: Page, text: string | RegExp) => p.getByRole('status').getByText(text).first();

test.describe.configure({ mode: 'serial' });

test('authentication: validation, wrong password, guards, sign-out', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/patient');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await page.getByLabel('Email').fill('patient3@gmail.com');
  await page.getByLabel('Password').fill('wrong-password-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' })).toBeVisible();

  await page.goto('/register');
  await page.getByLabel('Full name').fill('Mismatch Person');
  await page.getByLabel('Email').fill('mismatch@example.com');
  await page.getByLabel('Password', { exact: true }).fill('abc12345');
  await page.getByLabel('Confirm password').fill('abc12399');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Passwords do not match')).toBeVisible();

  const p = await signIn(browser, 'patient3@gmail.com', 'patient123');
  await p.getByRole('button', { name: 'Sign out' }).click();
  await expect(p).toHaveURL(/\/login$/);
  await p.goto('/patient');
  await expect(p).toHaveURL(/\/login$/);

  await page.goto('/this-does-not-exist');
  await expect(page.getByRole('heading', { name: "This page isn't in the queue" })).toBeVisible();
});

test('admin: doctors, slots, calendar, edit, deactivate, staff, policy, audit, reports', async ({ browser }) => {
  const admin = await signIn(browser, 'admin@gmail.com', 'admin123');

  // Add doctor with validation
  await admin.getByRole('link', { name: 'Doctors & schedules' }).click();
  await admin.getByRole('button', { name: 'Add doctor' }).first().click();
  await dialog(admin).getByRole('button', { name: 'Add doctor' }).click();
  await expect(dialog(admin).getByText('Enter a valid email')).toBeVisible();
  await dialog(admin).getByLabel('Full name').fill('Dr. Kiran Test');
  await dialog(admin).getByLabel('Sign-in email').fill('kiran.test@gmail.com');
  await dialog(admin).getByLabel('Temporary password').fill('Kiran2026');
  await dialog(admin).getByLabel('Department').fill('ENT');
  await dialog(admin).getByLabel('Room').fill('Room 105');
  await dialog(admin).getByLabel('Default visit length (minutes)').fill('9');
  await dialog(admin).getByRole('button', { name: 'Add doctor' }).click();
  await expect(toast(admin, 'Doctor added as D04')).toBeVisible();
  const card = admin.locator('.card', { hasText: 'Dr. Kiran Test' });
  await expect(card).toContainText('ENT, Room 105');

  // Generate slots
  await card.getByRole('button', { name: 'Generate slots' }).click();
  await dialog(admin).getByLabel('From').fill(clinicDay(1));
  await dialog(admin).getByLabel('To').fill(clinicDay(7));
  await dialog(admin).getByLabel('Session starts').fill('09:00');
  await dialog(admin).getByLabel('Session ends').fill('11:00');
  await dialog(admin).getByRole('button', { name: 'Generate slots' }).click();
  await expect(dialog(admin).getByText(/^Created \d+\. Skipped 0 overlapping/)).toBeVisible();
  await dialog(admin).getByRole('button', { name: 'Generate slots' }).click(); // idempotent second run
  await expect(dialog(admin).getByText(/^Created 0\. Skipped \d+ overlapping/)).toBeVisible();
  await dialog(admin).getByRole('button', { name: 'Close' }).first().click();
  await expect(card).toContainText(/\d+ slots in 14 days/);

  // Calendar + delete an unbooked slot
  await card.getByRole('button', { name: 'Calendar' }).click();
  await card.getByRole('button', { name: /\d+\/\d+ booked$/ }).first().click();
  const removeBtns = card.getByRole('button', { name: /^Remove .* slot$/ });
  const before = await removeBtns.count();
  await removeBtns.first().click();
  await expect(removeBtns).toHaveCount(before - 1);

  // Edit
  await card.getByRole('button', { name: 'Edit' }).click();
  await dialog(admin).getByLabel('Room').fill('Room 106');
  await dialog(admin).getByRole('button', { name: 'Save changes' }).click();
  await expect(card).toContainText('ENT, Room 106');

  // Deactivate / reactivate
  await card.getByRole('button', { name: 'Deactivate' }).click();
  await dialog(admin).getByRole('button', { name: 'Deactivate' }).click();
  await expect(card.getByText('Inactive', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Reactivate' }).click();
  await dialog(admin).getByRole('button', { name: 'Reactivate' }).click();
  await expect(card.getByText('Active', { exact: true })).toBeVisible();

  // New doctor can sign in
  const newDoc = await signIn(browser, 'kiran.test@gmail.com', 'Kiran2026');
  await expect(newDoc.getByRole('heading', { name: 'Dr. Kiran Test' })).toBeVisible();
  await expect(newDoc.getByText('Room is free')).toBeVisible();

  // People
  await admin.getByRole('link', { name: 'People' }).click();
  await admin.getByRole('button', { name: 'Add staff member' }).click();
  await dialog(admin).getByLabel('Full name').fill('Lata Front');
  await dialog(admin).getByLabel('Email').fill('lata@gmail.com');
  await dialog(admin).getByLabel('Temporary password').fill('Lata2026x');
  await dialog(admin).getByRole('button', { name: 'Create account' }).click();
  await expect(toast(admin, 'Account created')).toBeVisible();
  const row = admin.locator('li', { hasText: 'lata@gmail.com' });
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await dialog(admin).getByRole('button', { name: 'Deactivate' }).click();
  await expect(row.getByText('Inactive', { exact: true })).toBeVisible();
  const lata = await (await browser.newContext()).newPage();
  await lata.goto('/login');
  await lata.getByLabel('Email').fill('lata@gmail.com');
  await lata.getByLabel('Password').fill('Lata2026x');
  await lata.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(lata.getByRole('alert').filter({ hasText: 'deactivated' })).toBeVisible();
  await row.getByRole('button', { name: 'Reactivate' }).click();
  await dialog(admin).getByRole('button', { name: 'Reactivate' }).click();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  // Clinic policy
  await admin.getByRole('link', { name: 'Clinic policy' }).click();
  const ratio = admin.getByLabel('Booked patients called per walk-in');
  await ratio.fill('9');
  await expect(admin.getByText('Enter a whole number from 1 to 5')).toBeVisible();
  await ratio.fill('3');
  await admin.getByRole('button', { name: 'Save policy' }).click();
  await expect(toast(admin, 'Policy saved')).toBeVisible();
  await ratio.fill('2');
  await admin.getByRole('button', { name: 'Save policy' }).click();
  await expect(admin.getByRole('button', { name: 'Save policy' })).toBeDisabled();

  // Audit filter
  await admin.getByRole('link', { name: 'Audit log' }).click();
  await admin.getByLabel('Action', { exact: true }).selectOption('SETTINGS_UPDATED');
  await expect(admin.getByRole('cell', { name: 'Settings updated' })).toHaveCount(2);
  await admin.getByLabel('Action', { exact: true }).selectOption('DOCTOR_CREATED');
  await expect(admin.getByRole('cell', { name: 'Doctor created' })).toHaveCount(1);
  await admin.getByRole('button', { name: 'Clear' }).click();

  // Overview: change date, download CSV
  await admin.getByRole('link', { name: 'Overview' }).click();
  await admin.getByLabel('Report date').fill(clinicDay(-1));
  await expect(admin.getByRole('heading', { name: 'Doctor performance' })).toBeVisible();
  const dl = admin.waitForEvent('download');
  await admin.getByRole('button', { name: 'Daily CSV' }).click();
  expect((await dl).suggestedFilename()).toBe(`mediqueue-daily-${clinicDay(-1)}.csv`);

  for (const p of [admin, newDoc]) expect(errorsOf(p)).toEqual([]);
});

test('reception: check-in, no-show, cancel, filters, walk-in, absent and return, call next', async ({ browser }) => {
  const rec = await signIn(browser, 'reception@gmail.com', 'reception123');
  await expect(rec.getByRole('heading', { name: 'Front desk' })).toBeVisible();
  const rows = rec.locator('tbody tr');
  await expect.poll(() => rows.count()).toBeGreaterThan(3);
  const initial = await rows.count();

  // Check in the first pending appointment (late arrivals need a reason)
  const first = rows.first();
  const patientName = (await first.locator('td').nth(1).locator('p').first().textContent())!;
  await first.getByRole('button', { name: 'Check in' }).click();
  const late = dialog(rec).getByLabel('Reason for admitting');
  if (await late.isVisible({ timeout: 1500 }).catch(() => false)) {
    await late.fill('Called ahead, stuck in traffic');
    await dialog(rec).getByRole('button', { name: 'Check in' }).click();
  }
  await expect(rec.getByRole('dialog', { name: 'Token issued' })).toBeVisible();
  await expect(dialog(rec)).toContainText(patientName);
  await dialog(rec).getByRole('button', { name: 'Done' }).click();
  await expect(rows).toHaveCount(initial - 1);

  // Search and status filter
  await rec.getByLabel('Filter by status').selectOption('CHECKED_IN');
  await expect(rec.locator('tbody tr', { hasText: patientName }).first()).toBeVisible();
  await rec.getByLabel('Search arrivals').fill('zzzz-nobody');
  await expect(rec.getByText('No appointments match')).toBeVisible();
  await rec.getByLabel('Search arrivals').fill('');
  await rec.getByLabel('Filter by status').selectOption('ACTION');

  // No-show with reason
  const ns = rows.first();
  const nsName = (await ns.locator('td').nth(1).locator('p').first().textContent())!;
  await ns.getByRole('button', { name: 'No-show' }).click();
  await dialog(rec).getByRole('textbox').fill('Phoned, will not attend');
  await dialog(rec).getByRole('button', { name: 'Mark no-show' }).click();
  await expect(toast(rec, 'Marked as no-show')).toBeVisible();
  await rec.getByLabel('Filter by status').selectOption('NO_SHOW');
  await expect(rec.locator('tbody tr', { hasText: nsName }).first()).toBeVisible();
  await rec.getByLabel('Filter by status').selectOption('ACTION');

  // Cancel requires a reason
  const cx = rows.first();
  await cx.getByRole('button', { name: 'Cancel' }).click();
  await dialog(rec).getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(dialog(rec).getByText(/Give a short reason/)).toBeVisible();
  await dialog(rec).getByRole('textbox').fill('Rescheduled by phone');
  await dialog(rec).getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(toast(rec, 'Appointment cancelled')).toBeVisible();

  // Walk-in for an existing patient with Dr. Neha Shah
  await rec.getByRole('button', { name: 'Register walk-in' }).click();
  await dialog(rec).getByRole('button', { name: 'Issue token' }).click();
  await expect(dialog(rec).getByText('Choose a doctor')).toBeVisible();
  const v = await rec.locator('#wi-doctor option', { hasText: 'Dr. Neha Shah' }).getAttribute('value');
  await rec.locator('#wi-doctor').selectOption(v!);
  await dialog(rec).getByLabel('Find patient').fill('Vihaan');
  await dialog(rec).getByRole('option', { name: /Vihaan Nair/ }).click();
  await dialog(rec).getByRole('button', { name: 'Issue token' }).click();
  await expect(rec.getByRole('dialog', { name: 'Token issued' })).toContainText('Vihaan Nair');
  await expect(rec.getByLabel(/^Token D03-\d{3}$/)).toBeVisible();
  await dialog(rec).getByRole('button', { name: 'Done' }).click();

  // Queues tab: absent → return to queue → call next
  await rec.getByRole('tab', { name: /Doctor queues/ }).click();
  const shah = rec.locator('.card', { hasText: 'Dr. Neha Shah' }).filter({ hasText: 'Now serving' });
  await shah.getByRole('button', { name: 'Absent' }).first().click();
  await dialog(rec).getByRole('textbox').fill('Not in the waiting area');
  await dialog(rec).getByRole('button', { name: 'Mark absent' }).click();
  await expect(shah.getByText('Marked absent')).toBeVisible();
  await shah.getByRole('button', { name: 'Return to queue' }).first().click();
  await dialog(rec).getByRole('textbox').fill('Back at the desk');
  await dialog(rec).getByRole('button', { name: 'Return to queue' }).click();
  await expect(shah.getByText('Marked absent')).toHaveCount(0);
  await shah.getByRole('button', { name: 'Call next for the doctor' }).click();
  await expect(toast(rec, /^Called D03-/)).toBeVisible();
  await expect(shah.getByText('Called, on the way')).toBeVisible();

  expect(errorsOf(rec)).toEqual([]);
});

test('doctor: called-by-mistake, not here, start, complete, pause and resume', async ({ browser }) => {
  const doc = await signIn(browser, 'doctor3@gmail.com', 'doctor123');
  await expect(doc.getByRole('heading', { name: 'Dr. Neha Shah' })).toBeVisible();
  // patient was called by reception in the previous test
  await expect(doc.getByRole('button', { name: 'Start visit' })).toBeVisible();
  await doc.getByRole('button', { name: 'Called by mistake' }).click();
  await dialog(doc).getByRole('textbox').fill('Wrong token called');
  await dialog(doc).getByRole('button', { name: 'Return to waiting' }).click();
  await expect(doc.getByText('Room is free')).toBeVisible();

  await doc.getByRole('button', { name: 'Call next patient' }).click();
  await expect(toast(doc, /^Calling D03-/)).toBeVisible();
  await doc.getByRole('button', { name: 'Patient not here' }).click();
  await dialog(doc).getByRole('textbox').fill('No answer when called');
  await dialog(doc).getByRole('button', { name: 'Mark not here' }).click();
  await expect(doc.getByText('Room is free')).toBeVisible();

  const waiting = await doc.locator('ol li').count();
  if (waiting > 0) {
    await doc.getByRole('button', { name: 'Call next patient' }).click();
    await doc.getByRole('button', { name: 'Start visit' }).click();
    await expect(doc.getByText(/of about \d+ min/)).toBeVisible();
    await doc.getByRole('button', { name: 'Complete visit' }).click();
    await expect(toast(doc, 'Visit completed')).toBeVisible();
  }

  await doc.getByRole('button', { name: 'Pause queue' }).click();
  await dialog(doc).getByRole('button', { name: 'Pause queue' }).click();
  await expect(dialog(doc).getByText(/Give a short reason/)).toBeVisible();
  await dialog(doc).getByRole('textbox').fill('Ward round, back soon');
  await dialog(doc).getByRole('button', { name: 'Pause queue' }).click();
  await expect(doc.getByText('You paused the queue. No one new will be called.')).toBeVisible();
  await expect(doc.getByRole('button', { name: 'Call next patient' })).toBeDisabled();

  const board = await (await browser.newContext()).newPage();
  await board.goto('/board');
  await expect(board.locator('section', { hasText: 'Room 310' }).getByText('Paused').first()).toBeVisible();

  await doc.getByRole('button', { name: 'Resume queue' }).click();
  await expect(toast(doc, 'Queue resumed')).toBeVisible();
  await expect(board.locator('section', { hasText: 'Room 310' }).getByText('Paused')).toHaveCount(0, { timeout: 15_000 });
  expect(errorsOf(doc)).toEqual([]);
});

test('patient: notifications, appointments tabs, live token empty state', async ({ browser }) => {
  const p = await signIn(browser, 'patient1@gmail.com', 'patient123');
  const bell = p.getByRole('button', { name: /^Notifications/ });
  await bell.click();
  await expect(p.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
  const markAll = p.getByRole('button', { name: 'Mark all as read' });
  if (await markAll.isVisible().catch(() => false)) await markAll.click();
  await expect(bell).toHaveAccessibleName('Notifications');
  await p.keyboard.press('Escape');

  await p.getByRole('link', { name: 'My appointments', exact: true }).click();
  for (const t of ['Upcoming', 'Past', 'Cancelled']) {
    await p.getByRole('tab', { name: new RegExp(t) }).click();
    await expect(p.getByRole('tab', { name: new RegExp(t) })).toHaveAttribute('aria-selected', 'true');
  }
  await expect(p.locator('li', { hasText: 'Cancelled' }).first()).toBeVisible();

  const p4 = await signIn(browser, 'patient11@gmail.com', 'patient123');
  await p4.getByRole('link', { name: 'Live token', exact: true }).click();
  await expect(p4.getByText("You're not in a queue today").or(p4.getByLabel(/^Token D/))).toBeVisible();
  expect(errorsOf(p)).toEqual([]);
});

test('mobile layout and keyboard access', async ({ browser }) => {
  const m = await signIn(browser, 'patient1@gmail.com', 'patient123', { width: 390, height: 844 });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await m.getByRole('button', { name: 'Open menu' }).click();
  await m.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a visit' }).click();
  await expect(m.getByRole('heading', { name: 'Book a visit' })).toBeVisible();
  expect(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

  const k = await signIn(browser, 'reception@gmail.com', 'reception123');
  await expect(k).toHaveTitle('Front desk | MediQueue');
  await k.keyboard.press('Tab');
  await expect(k.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  const opener = k.getByRole('button', { name: 'Register walk-in' });
  await expect(opener).toBeEnabled(); // enabled once today's data has loaded
  await opener.focus();
  await k.keyboard.press('Enter');
  await expect(dialog(k)).toBeVisible();
  await k.keyboard.press('Escape');
  await expect(dialog(k)).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('experience layer: command palette, doctor shortcuts, cursor follower, reduced motion', async ({ browser }) => {
  // Ctrl+K palette navigates
  const admin = await signIn(browser, 'admin@gmail.com', 'admin123');
  await expect(admin.getByRole('heading', { level: 1, name: /Asha$/ })).toBeVisible();
  await admin.keyboard.press('Control+k');
  await admin.getByRole('combobox', { name: 'Search pages and actions' }).fill('people');
  await admin.keyboard.press('Enter');
  await expect(admin).toHaveURL(/\/admin\/staff$/);

  // Doctor keyboard shortcuts N (call), S (start), C (complete)
  const doc = await signIn(browser, 'doctor2@gmail.com', 'doctor123');
  await expect(doc.getByRole('heading', { name: 'Dr. Arjun Rao' })).toBeVisible();
  await expect(doc.getByRole('button', { name: /Call next patient/ })).toBeEnabled();
  await doc.keyboard.press('n');
  await expect(toast(doc, /^Calling D02-/)).toBeVisible();
  await expect(doc.getByRole('button', { name: /Start visit/ })).toBeEnabled();
  await doc.keyboard.press('s');
  await expect(doc.getByRole('button', { name: /Complete visit/ })).toBeEnabled();
  await doc.keyboard.press('c');
  await expect(toast(doc, 'Visit completed')).toBeVisible();

  // Cursor follower appears for a mouse user…
  await admin.mouse.move(300, 300);
  await admin.mouse.move(420, 360, { steps: 5 });
  await expect(admin.locator('.cursor-ring.is-visible')).toHaveCount(1);

  // …and is not rendered at all when the OS asks for reduced motion
  const calm = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await calm.goto('/');
  await calm.mouse.move(300, 300);
  await expect(calm.locator('.cursor-ring')).toHaveCount(0);
  await expect(calm.getByRole('heading', { name: /made predictable/ })).toBeVisible();
  expect(errorsOf(admin)).toEqual([]);
  expect(errorsOf(doc)).toEqual([]);
});

test('profile: edit details, upload and remove a photo, change password', async ({ browser }) => {
  const p = await signIn(browser, 'patient12@gmail.com', 'patient123');
  await p.getByRole('button', { name: 'Account menu' }).click();
  await p.getByRole('menuitem', { name: 'My profile' }).click();
  await expect(p).toHaveURL(/\/profile$/);

  // Details
  await p.locator('#pf-name').fill('Kavya Profile');
  await p.locator('#pf-phone').fill('+91 90000 12345');
  await p.getByRole('button', { name: 'Save details' }).click();
  await expect(toast(p, 'Details saved')).toBeVisible();
  await expect(p.getByRole('heading', { level: 1, name: 'Kavya Profile' })).toBeVisible();

  // Photo: a tiny generated PNG goes through the crop-and-compress path
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR4nGNgaGjBjoaWBABFP0EBdf2qfAAAAABJRU5ErkJggg==',
    'base64',
  );
  await p.getByLabel('Profile photo file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(toast(p, 'Photo updated')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Change profile photo' }).locator('img')).toBeVisible();
  await p.getByRole('button', { name: 'Remove photo' }).click();
  await expect(toast(p, 'Photo removed')).toBeVisible();

  // Password: wrong current password is refused, then a real change works for the next sign-in
  await p.locator('#pw-cur').fill('not-my-password');
  await p.locator('#pw-new').fill('NewPatient!2027');
  await p.locator('#pw-confirm').fill('NewPatient!2027');
  await p.getByRole('button', { name: 'Change password' }).click();
  await expect(p.getByText(/current password/i).first()).toBeVisible();
  await p.locator('#pw-cur').fill('patient123');
  await p.getByRole('button', { name: 'Change password' }).click();
  await expect(toast(p, 'Password changed')).toBeVisible();

  const again = await signIn(browser, 'patient12@gmail.com', 'NewPatient!2027');
  await expect(again.getByRole('heading', { level: 1, name: /Kavya$/ })).toBeVisible();
  // The one 400 is the deliberate wrong-current-password attempt above; anything else fails the test.
  expect(errorsOf(p).filter((e) => !e.includes('status of 400'))).toEqual([]);
  expect(errorsOf(again)).toEqual([]);
});
