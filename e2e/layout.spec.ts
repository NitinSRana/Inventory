import { expect, test, type Page } from '@playwright/test';

/**
 * Two layout rules, measured rather than eyeballed.
 *
 * This file looks like an exception to the suite's "never assert on markup"
 * rule and is not. It never names a class or a colour — those change every time
 * a screen is redesigned, which is why the other specs stay away from them. It
 * asserts two things a redesign is not allowed to break either way:
 *
 *   1. no screen scrolls sideways on a phone
 *   2. a control's real tap target is at least 44px tall
 *
 * Both are accessibility requirements in `.claude/rules/ui.md` rather than
 * style preferences, and neither is visible to a typecheck, a unit test or a
 * person glancing at a screenshot. The catalogue filter rows sat at 42px for a
 * week and nobody saw it; a `page.evaluate` found it in a second.
 */

/** The rules, measured in the page. */
const audit = () => {
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - doc.clientWidth;

  // Name what actually sticks out, so a failure points at the element rather
  // than just at the page. A wide table inside its own overflow-x container is
  // the documented pattern, not a fault, so anything scrollable is excluded.
  const culprits: string[] = [];
  if (overflow > 1) {
    const scrollable = (n: Element | null) => {
      for (let p = n; p; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > doc.clientWidth + 1 && !scrollable(el)) {
        culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
      }
    }
  }

  const short: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(
    'main button, main a[class*="h-1"], main input:not([type=hidden]), main select',
  )) {
    // A 20px checkbox inside a full-row label has a full-row tap target, so
    // measure what a thumb can hit rather than the box that is drawn.
    const target = el.closest('label') ?? el;
    const height = target.getBoundingClientRect().height;
    const what = (el.textContent || el.getAttribute('name') || '').trim().slice(0, 24);
    if (height > 0 && height < 44) short.push(`${el.tagName.toLowerCase()} ${Math.round(height)}px "${what}"`);
  }

  return { overflow, culprits: [...new Set(culprits)], short: [...new Set(short)] };
};

/** The first id on a list screen, so the detail pages have something to render. */
async function firstId(page: Page, listPath: string, segment: string) {
  await page.goto(listPath, { waitUntil: 'domcontentloaded' });
  const href = await page
    .locator(`a[href*="${segment}/"]`)
    .first()
    .getAttribute('href')
    .catch(() => null);
  return href?.split(`${segment}/`)[1]?.split(/[?#]/)[0] ?? null;
}

/** Every screen is used on a phone; only the table-heavy ones need a desk. */
const PHONE = [
  ['sales', '/en/sales'],
  ['products', '/en/products?needs=1'],
  ['catalogue import', '/en/products/import'],
  ['opening stock import', '/en/products/import/opening'],
  ['VAT report', '/en/reports/vat'],
  ['corrections report', '/en/reports/corrections'],
  ['low stock report', '/en/reports/low-stock'],
  ['team', '/en/settings/team'],
  ['scan', '/en/scan'],
  ['more', '/en/more'],
] as const;

const DESK = [
  ['VAT report', '/en/reports/vat'],
  ['corrections report', '/en/reports/corrections'],
  ['low stock report', '/en/reports/low-stock'],
] as const;

for (const [name, path] of PHONE) {
  test(`${name} fits a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const { overflow, culprits, short } = await page.evaluate(audit);

    expect(overflow, `scrolls sideways by ${overflow}px: ${culprits.join('; ')}`).toBeLessThanOrEqual(1);
    expect(short, 'controls under the 44px minimum').toEqual([]);
  });
}

for (const [name, path] of DESK) {
  test(`${name} fits a desk`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const { overflow, culprits } = await page.evaluate(audit);
    expect(overflow, `scrolls sideways by ${overflow}px: ${culprits.join('; ')}`).toBeLessThanOrEqual(1);
  });
}

test('a product page fits a phone, filters and all', async ({ page }) => {
  const id = await firstId(page, '/en/products', '/products');
  test.skip(!id, 'no products in this shop yet');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/en/products/${id}#movements`, { waitUntil: 'domcontentloaded' });
  const { overflow, culprits, short } = await page.evaluate(audit);

  expect(overflow, `scrolls sideways by ${overflow}px: ${culprits.join('; ')}`).toBeLessThanOrEqual(1);
  expect(short, 'controls under the 44px minimum').toEqual([]);
});

test('a supplier page fits a phone', async ({ page }) => {
  const id = await firstId(page, '/en/suppliers', '/suppliers');
  test.skip(!id, 'no suppliers in this shop yet');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/en/suppliers/${id}`, { waitUntil: 'domcontentloaded' });
  const { overflow, culprits, short } = await page.evaluate(audit);

  expect(overflow, `scrolls sideways by ${overflow}px: ${culprits.join('; ')}`).toBeLessThanOrEqual(1);
  expect(short, 'controls under the 44px minimum').toEqual([]);
});
