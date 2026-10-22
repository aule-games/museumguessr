// v1.2 rules in the browser: the early year stop, the difficulty label,
// "hard ones nailed" and challenge rules versions. Relative URLs only, so the
// suite runs under any base path.
import { confirm, expect, placePin, start, test } from './fixtures';

/** Play round 1's Made question and open When. */
async function openWhen(page: import('@playwright/test').Page) {
  await start(page);
  await placePin(page, 41.9, 12.5);
  await confirm(page);
  await expect(page.locator('[data-screen=round][data-step=when]')).toBeVisible();
}

test.describe('the year stop', () => {
  test('the keyboard reaches the stop with Home and Left, leaves it with Right, and the answer survives Back [V12-70]', async ({ page }) => {
    await openWhen(page);
    const slider = page.getByRole('slider');
    const readout = page.locator('[data-test=year-readout]');
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(readout).toHaveText('4000 BCE or earlier');
    await expect(slider).toHaveAttribute('aria-valuetext', '4000 BCE or earlier');
    await expect(page.getByLabel('Year', { exact: true })).toHaveValue('4000');
    await expect(page.locator('[data-test=year-suffix]')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(readout).toHaveText('3999 BCE');
    await page.keyboard.press('ArrowLeft');
    await expect(readout).toHaveText('4000 BCE or earlier');
    await confirm(page);
    await expect(page.locator('[data-screen=round][data-step=kept]')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('museumguessr:v1:save') ?? '{}').answers[0].when)).toBe(-4001);
    await page.locator('[data-test=back]').click();
    await expect(readout).toHaveText('4000 BCE or earlier');
    await page.getByRole('button', { name: 'CE', exact: true }).click();
    await expect(readout).toHaveText('—');
    await expect(page.getByLabel('Year', { exact: true })).toHaveValue('');
    await expect(page.locator('[data-test=confirm]')).toBeDisabled();
  });

  test('typing 5000 BCE selects the stop, and with the phone keyboard open the field, era switch and Confirm stay on screen [V12-70] [V12-71]', async ({ page }) => {
    await openWhen(page);
    const field = page.getByLabel('Year', { exact: true });
    await page.getByRole('button', { name: 'BCE', exact: true }).click();
    await field.fill('5000');
    await expect(page.locator('[data-test=year-readout]')).toHaveText('4000 BCE or earlier');
    await expect(field).toHaveValue('4000');
    await field.focus();
    // A simulated on-screen keyboard: the visual viewport loses its lower 336 px.
    const size = page.viewportSize() ?? { width: 390, height: 844 };
    const visible = size.height - 336;
    await page.setViewportSize({ width: size.width, height: visible });
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height'))).toBe(`${visible}px`);
    for (const target of [field, page.getByRole('button', { name: /^BCE/ }), page.getByRole('button', { name: 'CE', exact: true }), page.locator('[data-test=confirm]')]) {
      const box = await target.boundingBox();
      expect(box, String(target)).not.toBeNull();
      expect(box!.y, String(target)).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, String(target)).toBeLessThanOrEqual(visible + 0.5);
    }
    await expect(page.locator('[data-test=confirm]')).toBeEnabled();
  });
});
