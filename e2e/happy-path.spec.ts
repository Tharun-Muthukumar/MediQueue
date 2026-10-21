import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Cross-role happy path on the seeded demo day (Appendix B.2 scenario for Dr. Maya Iyer):
 * D01-001 completed, D01-002 in consultation, D01-003 walk-in, D01-004 Aarav (patient1), D01-005 walk-in.
 */

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

test('patient, doctor, reception and admin complete a queue cycle', async ({ browser }) => {
  // Patient sees their token and position
  const patient = await signIn(browser, 'patient1@gmail.com', 'patient123');
  await expect(patient).toHaveURL(/\/patient$/);
  await expect(patient.getByLabel('Token D01-004')).toBeVisible();
  await expect(patient.getByText('1 person ahead of you', { exact: true })).toBeVisible();

  // Doctor finishes the current visit, then follows the 2:1 policy
  const doctor = await signIn(browser, 'doctor1@gmail.com', 'doctor123');
  await expect(doctor.getByText('Kabir Sethi', { exact: true })).toBeVisible();
  await doctor.getByRole('button', { name: 'Complete visit' }).click();
  await expect(doctor.getByText('Visit completed', { exact: true })).toBeVisible();
  await doctor.getByRole('button', { name: 'Call next patient' }).click();
  await expect(doctor.getByText('Calling D01-003')).toBeVisible(); // walk-in after two booked patients
  await doctor.getByRole('button', { name: 'Start visit' }).click();
  await doctor.getByRole('button', { name: 'Complete visit' }).click();
  await doctor.getByRole('button', { name: 'Call next patient' }).click();
  await expect(doctor.getByText('Calling D01-004')).toBeVisible();

  // The patient's screen updates without a reload
  await expect(patient.getByText("It's your turn", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(patient.getByText('Please go to Room 101 now to see Dr. Maya Iyer.')).toBeVisible();

  // Reception registers a walk-in and receives a token
  const reception = await signIn(browser, 'reception@gmail.com', 'reception123');
  await reception.getByRole('button', { name: 'Register walk-in' }).click();
  const value = await reception.locator('#wi-doctor option', { hasText: 'Dr. Arjun Rao' }).getAttribute('value');
  await reception.locator('#wi-doctor').selectOption(value!);
  await reception.getByRole('tab', { name: 'New walk-in profile' }).click();
  await reception.getByLabel('Full name').fill('Test Walk In');
  await reception.getByRole('button', { name: 'Issue token' }).click();
  await expect(reception.getByRole('dialog', { name: 'Token issued' })).toBeVisible();
  await expect(reception.getByLabel('Token D02-002')).toBeVisible();

  // Admin sees today's completed visits
  const admin = await signIn(browser, 'admin@gmail.com', 'admin123');
  await expect(admin.getByRole('heading', { level: 1, name: /Asha$/ })).toBeVisible();
  const completed = admin.locator('[data-stat="Visits completed"] [data-value]');
  await expect(completed).toHaveText('3');
  const download = admin.waitForEvent('download');
  await admin.getByRole('button', { name: 'Daily CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^mediqueue-daily-\d{4}-\d{2}-\d{2}\.csv$/);

  // Role isolation in the browser: a patient cannot open admin pages
  await patient.goto('/admin');
  await expect(patient).toHaveURL(/\/patient$/);
});

test('a new patient registers, books and cancels a future visit', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Nisha Rao');
  await page.getByLabel('Email').fill(`nisha.${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('Visit2026');
  await page.getByLabel('Confirm password').fill('Visit2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/patient\/book$/);
  await page.getByRole('button', { name: /Dr\. Neha Shah/ }).click();
  // pick the first day (after tomorrow) that has a free slot
  const days = page.getByRole('option');
  let booked = false;
  for (let i = 2; i < 10 && !booked; i++) {
    await days.nth(i).click();
    await expect(page.getByText(/^Crossed-out times/).or(page.getByText(/has no sessions on/))).toBeVisible();
    const free = page.locator('button.tabular:not([disabled])').first();
    if ((await page.locator('button.tabular:not([disabled])').count()) > 0) {
      await free.click();
      await page.getByRole('button', { name: 'Book this time' }).click();
      booked = true;
    }
  }
  expect(booked).toBe(true);
  await expect(page).toHaveURL(/\/patient\/appointments$/);
  await expect(page.getByText('Appointment booked')).toBeVisible();
  const row = page.locator('li', { hasText: 'Dr. Neha Shah' }).first();
  await row.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(page.getByText('Appointment cancelled')).toBeVisible();
});
