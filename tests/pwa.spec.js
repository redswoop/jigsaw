import { test, expect } from '@playwright/test';

// These tests exercise manifest + service-worker behavior. They are written
// against the dev server (Vite on :5173) like the rest of the suite. Chrome
// DevTools' Application panel is a good manual complement when debugging
// failures here.

async function waitForActiveSW(page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // sw.js calls clients.claim(), so controller should attach without a reload.
  // But on a brand-new registration, the first navigation predates the SW by
  // definition, so if controller is still null after ready, reload once.
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
  // Wait for the home screen to render so /api/packs has been cached.
  await page.waitForSelector('.pack-card', { timeout: 10_000 });
}

async function pickSmallestPack(page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/packs');
    const data = await res.json();
    const packs = Array.isArray(data) ? data : data.packs;
    packs.sort((a, b) => a.images.length - b.images.length);
    const p = packs[0];
    const idx = packs.findIndex(x => x.name === p.name);
    return { name: p.name, label: p.label, index: idx, count: p.images.length };
  });
}

test.describe('PWA: manifest', () => {
  test('manifest.json is valid and has required fields', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.ok()).toBe(true);
    const m = await res.json();

    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBeTruthy();
    expect(m.background_color).toBeTruthy();
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons.some(i => i.sizes === '192x192')).toBe(true);
    expect(m.icons.some(i => i.sizes === '512x512')).toBe(true);

    for (const icon of m.icons) {
      const r = await request.get(icon.src);
      expect(r.ok(), `icon ${icon.src} should be reachable`).toBe(true);
      expect(r.headers()['content-type'] || '').toMatch(/image\//);
    }
  });
});

test.describe('PWA: service worker', () => {
  test('registers, activates, and controls the page', async ({ page }) => {
    await waitForActiveSW(page);

    const info = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return {
        scriptURL: reg.active?.scriptURL,
        scope: reg.scope,
        controller: navigator.serviceWorker.controller?.scriptURL,
      };
    });
    expect(info.scriptURL).toMatch(/\/sw\.js$/);
    expect(info.scope).toMatch(/\/$/);
    expect(info.controller).toMatch(/\/sw\.js$/);
  });

  test('shell cache is populated on install', async ({ page }) => {
    await waitForActiveSW(page);

    const shell = await page.evaluate(async () => {
      const keys = await caches.keys();
      const shellKey = keys.find(k => k.startsWith('jigsaw-shell-'));
      if (!shellKey) return null;
      const c = await caches.open(shellKey);
      const reqs = await c.keys();
      return {
        cacheName: shellKey,
        paths: reqs.map(r => new URL(r.url).pathname),
      };
    });

    expect(shell, 'shell cache should exist').not.toBeNull();

    // A representative subset — sw.js declares the full list. Keep this short
    // so it doesn't need updating every time we add a JS module.
    const required = [
      '/',
      '/index.html',
      '/css/style.css',
      '/js/app.js',
      '/js/game.js',
      '/js/scoring.js',
      '/manifest.json',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
    ];
    for (const p of required) {
      expect(shell.paths, `${p} should be in shell cache`).toContain(p);
    }
  });
});

test.describe('PWA: offline behavior', () => {
  test('app shell loads when offline', async ({ page, context }) => {
    await waitForActiveSW(page);

    await context.setOffline(true);
    await page.reload();

    // The Vue app should boot and render the home screen from cache.
    await expect(page.locator('.pack-gallery')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.pack-card').first()).toBeVisible();
  });

  test('/api/packs falls back to cache when offline (networkFirst)', async ({ page, context }) => {
    await waitForActiveSW(page);

    // Capture the pack count online so we can verify offline matches.
    const onlineCount = await page.locator('.pack-card').count();
    expect(onlineCount).toBeGreaterThan(0);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('.pack-card').first()).toBeVisible({ timeout: 5_000 });
    const offlineCount = await page.locator('.pack-card').count();
    expect(offlineCount).toBe(onlineCount);
  });

  test('uncached pack is marked unavailable when offline', async ({ page, context }) => {
    await waitForActiveSW(page);

    // Nothing has been downloaded via the pack-download button in this context,
    // so no pack should be cached. Go offline — every card should show the
    // "not available offline" overlay.
    await context.setOffline(true);
    // Belt and suspenders: setOffline updates navigator.onLine and fires the
    // offline event, but some browser builds are flaky. Fire manually to be
    // sure the Vue ref flips.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    const overlay = page.locator('.pack-offline-overlay').first();
    await expect(overlay).toBeVisible({ timeout: 3_000 });

    // Clicking a card with the overlay must not navigate to the picker.
    await page.locator('.pack-card').first().click();
    await expect(page.locator('.pack-gallery')).toBeVisible();
    await expect(page.locator('.picker')).toHaveCount(0);
  });
});

test.describe('PWA: pack download', () => {
  // Downloading a whole pack (images + thumbnails) is slower than the rest.
  test.setTimeout(90_000);

  test('downloads images, shows progress, marks cached', async ({ page }) => {
    await waitForActiveSW(page);

    const pack = await pickSmallestPack(page);
    expect(pack.count).toBeGreaterThan(0);

    // Observe the number of cached image entries before the download.
    const beforeCount = await page.evaluate(async () => {
      const keys = await caches.keys();
      if (!keys.includes('jigsaw-images')) return 0;
      const c = await caches.open('jigsaw-images');
      return (await c.keys()).length;
    });

    // Click the download button on the target pack card.
    const card = page.locator('.pack-card').nth(pack.index);
    await expect(card.locator('.pack-download-btn').first()).toBeVisible();
    await card.locator('.pack-download-btn').first().click();

    // While downloading the button gets the .downloading class.
    await expect(card.locator('.pack-download-btn.downloading')).toBeVisible({ timeout: 5_000 });

    // Completion = cached badge appears on this card.
    await expect(card.locator('.pack-cached-badge')).toBeVisible({ timeout: 60_000 });

    // Image cache should now include this pack's URLs.
    const afterCount = await page.evaluate(async () => {
      const c = await caches.open('jigsaw-images');
      return (await c.keys()).length;
    });
    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBeGreaterThanOrEqual(pack.count);
  });

  test('downloaded pack remains clickable offline', async ({ page, context }) => {
    await waitForActiveSW(page);

    const pack = await pickSmallestPack(page);
    const card = page.locator('.pack-card').nth(pack.index);

    await card.locator('.pack-download-btn').first().click();
    await expect(card.locator('.pack-cached-badge')).toBeVisible({ timeout: 60_000 });

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    // The downloaded pack must NOT show the offline overlay.
    await expect(card.locator('.pack-offline-overlay')).toHaveCount(0);

    // Clicking it should navigate to the picker and show thumbnails from cache.
    await card.click();
    await expect(page.locator('.screen-picker')).toBeVisible({ timeout: 5_000 });

    // First thumbnail should actually decode (naturalWidth > 0) — proves it
    // came from cache, not just that the <img> is in the DOM.
    const firstThumb = page.locator('.image-card img').first();
    await expect(firstThumb).toBeVisible({ timeout: 5_000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('.image-card img');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 5_000 });
  });
});
