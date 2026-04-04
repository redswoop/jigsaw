import { test, expect } from '@playwright/test';

// Difficulty presets: cols value → label
const difficulties = [
  { label: 'kids', cols: 2 },
  { label: 'easy', cols: 4 },
  { label: 'medium', cols: 6 },
];

/**
 * Verify that all puzzle tiles are visible within the viewport.
 * The board uses transform: scale() to fit — if the layout box doesn't match
 * the visual size, tiles can be clipped outside the viewport.
 */
async function assertAllTilesVisible(page) {
  // Wait for tiles to render
  await page.waitForSelector('.tile', { timeout: 10_000 });
  const tiles = page.locator('.tile');
  const count = await tiles.count();
  expect(count).toBeGreaterThan(0);

  const viewport = page.viewportSize();

  // Check every tile is within the visible viewport
  for (let i = 0; i < count; i++) {
    const box = await tiles.nth(i).boundingBox();
    expect(box, `tile ${i} should have a bounding box`).toBeTruthy();

    // Tile should be at least partially visible in the viewport
    const visibleX = box.x + box.width > 0 && box.x < viewport.width;
    const visibleY = box.y + box.height > 0 && box.y < viewport.height;
    expect(visibleX, `tile ${i} x=${box.x.toFixed(0)} w=${box.width.toFixed(0)} should be within viewport width=${viewport.width}`).toBe(true);
    expect(visibleY, `tile ${i} y=${box.y.toFixed(0)} h=${box.height.toFixed(0)} should be within viewport height=${viewport.height}`).toBe(true);
  }
}

/**
 * Verify the board doesn't overflow its container.
 */
async function assertBoardFitsContainer(page) {
  const board = page.locator('#board');
  const wrap = page.locator('#board-wrap');

  const boardBox = await board.boundingBox();
  const wrapBox = await wrap.boundingBox();

  expect(boardBox).toBeTruthy();
  expect(wrapBox).toBeTruthy();

  // Board's visual bounds should be within board-wrap (with small tolerance for rounding)
  const tolerance = 2;
  expect(boardBox.x).toBeGreaterThanOrEqual(wrapBox.x - tolerance);
  expect(boardBox.y).toBeGreaterThanOrEqual(wrapBox.y - tolerance);
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(wrapBox.x + wrapBox.width + tolerance);
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(wrapBox.y + wrapBox.height + tolerance);
}

/**
 * Verify the expected number of tiles are rendered for a given column count.
 */
async function assertTileCount(page, cols) {
  await page.waitForSelector('.tile', { timeout: 10_000 });
  const count = await page.locator('.tile').count();
  // With cols columns and aspect-based rows, minimum is cols * 2
  expect(count).toBeGreaterThanOrEqual(cols * 2);
}

for (const { label, cols } of difficulties) {
  test(`${label} mode (${cols} cols): all tiles visible and board fits`, async ({ page }) => {
    await page.goto(`/?puzzle=1&cols=${cols}&pack=architecture`);
    await assertTileCount(page, cols);
    await assertAllTilesVisible(page);
    await assertBoardFitsContainer(page);
  });
}

test('board resizes correctly on orientation change', async ({ page }) => {
  await page.goto('/?puzzle=1&cols=4&pack=architecture');
  await page.waitForSelector('.tile', { timeout: 10_000 });

  // Check initial layout
  await assertAllTilesVisible(page);
  await assertBoardFitsContainer(page);

  // Simulate orientation change by swapping viewport dimensions
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.height, height: vp.width });

  // Wait for resize to propagate
  await page.waitForTimeout(500);

  await assertAllTilesVisible(page);
  await assertBoardFitsContainer(page);
});

test('board caption does not cause tile clipping', async ({ page }) => {
  // Navigate via URL to a pack that has image names (captions)
  await page.goto('/?puzzle=1&cols=2&pack=architecture');
  await page.waitForSelector('.tile', { timeout: 10_000 });

  // If a caption is present, verify tiles are still all visible
  const captionVisible = await page.locator('.board-caption').isVisible().catch(() => false);
  // Either way, all tiles must be visible
  await assertAllTilesVisible(page);
  await assertBoardFitsContainer(page);
});

test('toolbar is fully visible and not overlapping the board', async ({ page }) => {
  await page.goto('/?puzzle=1&cols=4&pack=architecture');
  await page.waitForSelector('.tile', { timeout: 10_000 });

  const toolbar = page.locator('.puzzle-toolbar');
  const board = page.locator('#board');

  const toolbarBox = await toolbar.boundingBox();
  const boardBox = await board.boundingBox();

  expect(toolbarBox).toBeTruthy();
  expect(boardBox).toBeTruthy();

  // Toolbar should be above the board with no overlap
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(boardBox.y + 2);
});
