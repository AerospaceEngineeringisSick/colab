import { chromium } from 'playwright';

export const SITE_PAGES = ['index.html', 'services.html', 'pricing.html', 'about.html', 'work.html', 'referrals.html', 'contact.html', 'privacy.html', 'terms.html', '404.html'];
export const EXAMPLES = ['smith-and-sons', 'crumb-and-kiln', 'northside-barber', 'petal-and-stem', 'volt-strength', 'tidewater', 'form-and-field'];
export const EXAMPLE_PAGES = EXAMPLES.map(s => `work/${s}/index.html?shot`);

// CHROMIUM_PATH lets you point at an existing Chrome/Chromium instead of Playwright's download.
export function launch() {
  const opts = { args: ['--ignore-gpu-blocklist'] };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

export const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  phone: { viewport: { width: 412, height: 800 }, hasTouch: true, isMobile: true },
  small: { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true },
};

// Google Fonts on the example sites: blocked in checks so a slow network never stalls them.
export async function newContext(browser, vp, extra = {}) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vp], ...extra });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return ctx;
}
