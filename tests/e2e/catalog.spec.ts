import { test, expect } from '@playwright/test';

test('visitor can move from catalogue to a product conversation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Treino forte/i })).toBeVisible();
  await page.getByRole('link', { name: 'Explorar produtos' }).click();
  await expect(page).toHaveURL(/\/produtos\/$/);
  await page.getByRole('link', { name: /Ver Banco Supino Inclinado/ }).first().click();
  await expect(page).toHaveURL(/\/produtos\/banco-supino-inclinado\/$/);
  await expect(page.getByRole('link', { name: 'Falar sobre este equipamento' })).toHaveAttribute('href', /wa\.me\/5548999263333/);
});

test('mobile navigation remains accessible in the light-only theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('button', { name: /Alternar tema/i })).toHaveCount(0);
  await page.getByRole('button', { name: /Abrir menu/i }).click();
  await expect(page.locator('#mobile-menu')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
