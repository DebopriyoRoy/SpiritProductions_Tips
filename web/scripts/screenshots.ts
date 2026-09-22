/**
 * Capture screenshots of the running app.
 *
 *   npm run dev          # in one terminal
 *   npm run screenshots  # in another
 *
 * Env:
 *   BASE_URL        default http://127.0.0.1:3000
 *   SHOTS_DIR       default ./screenshots
 *   CHROMIUM_PATH   explicit browser binary, if Playwright cannot find one
 */
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const OUT = process.env.SHOTS_DIR ?? path.join(process.cwd(), 'screenshots');

/**
 * Sandboxes and CI images often ship a Chromium that Playwright's own
 * version-pinned lookup misses, so fall back to whatever is on disk.
 */
function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .pop();
  if (!dir) return undefined;
  const bin = path.join(root, dir, 'chrome-linux', 'chrome');
  return existsSync(bin) ? bin : undefined;
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (err) {
    const executablePath = findChromium();
    if (!executablePath) throw err;
    return chromium.launch({ executablePath });
  }
}

async function firstEventId(): Promise<string> {
  const res = await fetch(`${BASE}/?location=spirit`);
  if (!res.ok) throw new Error(`${BASE} returned ${res.status}`);
  const m = (await res.text()).match(/\/events\/([A-Za-z0-9]+)\?location=/);
  if (!m) {
    throw new Error(
      'No events found. Run "npm run seed" first, then retry.',
    );
  }
  return m[1];
}

interface Shot {
  name: string;
  url: string;
  /** Clip to the panel containing this text instead of the viewport. */
  panel?: string;
  dark?: boolean;
  mobile?: boolean;
}

async function capture(ctx: BrowserContext, shot: Shot) {
  const page = await ctx.newPage();
  await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 30_000 });

  if (shot.panel) {
    // The header is sticky, so it would otherwise render across the middle of
    // a clipped element capture. Pin it down for the shot only.
    await page.addStyleTag({ content: 'header.bar{position:static !important}' });
    const el = page.locator('.panel', { hasText: shot.panel }).first();
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await el.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  } else {
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
  }

  console.log(`  ${shot.name}.png`);
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const id = await firstEventId();
  const event = `${BASE}/events/${id}?location=spirit`;

  const shots: Shot[] = [
    { name: '1-home', url: `${BASE}/?location=spirit` },
    { name: '2-event-top', url: event },
    { name: '3-cast', url: event, panel: 'Cast & Musicians — paid per head' },
    { name: '4-staff', url: event, panel: 'Staff — paid per hour' },
    { name: '5-per-person', url: event, panel: 'Payout per person' },
    { name: '6-acc', url: `${BASE}/?location=acc` },
    { name: '7-dark', url: event, dark: true },
    { name: '8-mobile', url: event, mobile: true },
  ];

  const browser = await launch();
  console.log(`Capturing ${shots.length} screenshots to ${OUT}`);

  for (const shot of shots) {
    const ctx = await browser.newContext({
      viewport: shot.mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: shot.dark ? 'dark' : 'light',
    });
    try {
      await capture(ctx, shot);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(`\nScreenshots failed: ${err.message}`);
  console.error('Is the app running? Start it with "npm run dev".');
  process.exit(1);
});
