// Headless-browser helpers for Power Apps portals.
//
// The portal's anti-forgery token and base64SecureConfiguration are produced by
// client-side Power Apps JS (the secure config is server-encrypted and absent
// from the static HTML), so we can't reconstruct the requests with plain fetch
// alone. We drive a real browser to (a) capture a session triple off the
// entitylist's own grid POST, and (b) render detail pages whose subgrids bake
// the parent record id into a per-page secure config (so they can't be replayed
// generically either).
//
// Playwright is an OPTIONAL dependency, imported dynamically and typed locally
// so the rest of the toolchain type-checks without it installed. To enable:
//   pnpm add -D playwright && pnpm exec playwright install chromium
//
// Env knobs (handy in sandboxes / CI with a pre-cached browser):
//   PLAYWRIGHT_CHROMIUM_PATH  - explicit chromium executable path
//   PORTAL_HEADFUL=1          - run with a visible window (debugging)

export const PORTAL_USER_AGENT =
  "Mozilla/5.0 (compatible; PubdiffBot/1.0; +https://pubdiff.github.io/lobbyist-tracker/)";

// Minimal structural types for the slice of Playwright we touch, kept local so
// `playwright` need not be installed to compile.
export interface PwRequest {
  method(): string;
  url(): string;
  headers(): Record<string, string>;
  postData(): string | null;
}
export interface PwResponse {
  url(): string;
  status(): number;
  text(): Promise<string>;
}
export interface PwPage {
  on(event: "request", handler: (req: PwRequest) => void): void;
  on(event: "response", handler: (res: PwResponse) => void): void;
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  addInitScript(script: string | { content: string }): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T>(fn: (...a: any[]) => T, arg?: unknown): Promise<T>;
  close(): Promise<void>;
}

// tsx/esbuild transpiles page.evaluate callbacks with a `__name(...)` keep-names
// helper. That helper lives in the Node module scope, not the browser, so a
// serialised callback throws "ReferenceError: __name is not defined" in the
// page. Inject a no-op shim before navigation (as a raw string so it is not
// itself transpiled) to satisfy the reference. Harmless in production (plain
// `node`/`tsc` builds don't emit __name).
export const NAME_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f };";

export async function installNameShim(page: PwPage): Promise<void> {
  await page.addInitScript(NAME_SHIM);
}
export interface PwContext {
  newPage(): Promise<PwPage>;
  cookies(): Promise<Array<{ name: string; value: string }>>;
}
export interface PwBrowser {
  newContext(opts: { userAgent: string }): Promise<PwContext>;
  close(): Promise<void>;
}

interface PwChromium {
  launch(opts: { headless: boolean; executablePath?: string }): Promise<PwBrowser>;
}

export async function launchBrowser(): Promise<PwBrowser> {
  let chromium: PwChromium;
  try {
    const spec = "playwright"; // non-literal so tsc doesn't resolve the optional dep
    const mod = (await import(spec)) as unknown as { chromium: PwChromium };
    chromium = mod.chromium;
  } catch {
    throw new Error(
      "playwright is not installed. Run: pnpm add -D playwright && pnpm exec playwright install chromium",
    );
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  return chromium.launch({ headless: process.env.PORTAL_HEADFUL !== "1", executablePath });
}

export async function newPortalContext(browser: PwBrowser): Promise<PwContext> {
  return browser.newContext({ userAgent: PORTAL_USER_AGENT });
}
