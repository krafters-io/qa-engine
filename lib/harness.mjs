/**
 * Krafters QA harness ENGINE (reusable; do not edit per deliverable).
 *
 * Sets up the composed 16:9 recording (console panel LEFT + same-origin app
 * iframe RIGHT, visible cursor, live network), authenticates once, waits for
 * hydration, runs a per-deliverable `scenario(ctx)` callback, then transcodes to
 * an H.264 mp4 (< 50MB) and optionally a verification contact sheet.
 *
 * A new deliverable's QA is just a short scenario file that calls record():
 *
 *   import { record } from "./lib/harness.mjs";
 *   record({ title: "…", scenario: async (t) => { …use t.step/t.app/… } });
 *
 * The ctx (`t`) handed to a scenario:
 *   t.page   harness top page          t.app   frameLocator("#app")
 *   t.ORIGIN t.FRAME t.APP             t.sleep(ms)
 *   t.step/ok/note/warn/line           console-panel writers (cyan/green/…)
 *   t.moveTo(locator,{click})          human-like cursor move + reliable click
 *   t.navTo(path,{ready})              point the iframe at a path + await hydration
 *   t.hydrate(locator)                 await a locator's React fiber (interactive)
 *   t.psql(sql)                        local Postgres one-liner (baseline/asserts)
 *
 * Env (all optional except creds): QA_APP_ORIGIN, QA_EMAIL, QA_PASSWORD,
 * QA_VIEWPORT(desktop|mobile), QA_TITLE, QA_OUT, QA_DB_URL, FFMPEG_PATH,
 * QA_CONTACTSHEET=1.  IMPORTANT: record against a PROD build (see serve.sh) —
 * `next dev` doesn't hydrate headless.
 */

import { chromium } from "playwright";
import { mapInteractables, findInteractable } from "./discover.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILES = {
  desktop: { frame: { width: 1920, height: 1080 }, app: { width: 1280, height: 800 }, emulate: null },
  mobile: {
    frame: { width: 1600, height: 900 },
    app: { width: 390, height: 844 },
    emulate: {
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
  },
};

const CONSOLE_W = 560;

const harnessHtml = (FRAME) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${FRAME.width}px;height:${FRAME.height}px;background:#0b0e14;overflow:hidden;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  #frame{display:flex;width:${FRAME.width}px;height:${FRAME.height}px}
  #console{width:${CONSOLE_W}px;height:${FRAME.height}px;box-sizing:border-box;padding:20px 18px;
    overflow:hidden;border-right:1px solid #1f2430;background:linear-gradient(180deg,#0d111a,#0b0e14)}
  #title{font-size:15px;margin:0 0 6px;color:#fff;font-weight:600;letter-spacing:.3px}
  #sub{font-size:11.5px;color:#6b7686;margin:0 0 14px}
  #log{font-size:12.5px;line-height:1.7}
  .row{white-space:pre-wrap;word-break:break-word}
  .step{color:#7fd1e8}.ok{color:#a6e3a1}.note{color:#9aa5b1}.net{color:#8b97a7}.warn{color:#f9e2af}
  .badge{display:inline-block;min-width:26px;text-align:center;border-radius:4px;
    padding:0 5px;margin-right:7px;font-weight:700;font-size:11px}
  .s2{background:#13351f;color:#a6e3a1}.s3{background:#3a341e;color:#f9e2af}
  .s4{background:#3a1e1e;color:#f38ba8}.method{color:#cdd6f4;margin-right:6px}
  #appwrap{width:${FRAME.width - CONSOLE_W}px;height:${FRAME.height}px;display:flex;align-items:center;justify-content:center}
  #app{width:${FRAME.app?.width ?? 1280}px;height:${FRAME.app?.height ?? 800}px;border:0;background:#fff;box-shadow:0 10px 50px rgba(0,0,0,.55)}
</style></head><body>
  <div id="frame">
    <div id="console"><div id="title"></div><div id="sub">QA · composed frame · live console</div><div id="log"></div></div>
    <div id="appwrap"><iframe id="app"></iframe></div>
  </div>
</body></html>`;

// Cursor + click-ripple overlay, rendered ONLY inside the app iframe.
const CURSOR_INIT = `(() => {
  if (window.self === window.top) return;
  const mk = () => {
    const c = document.createElement('div');
    c.id='__qa_cursor';
    c.style.cssText='position:fixed;z-index:2147483647;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:rgba(56,189,248,.30);border:2px solid #38bdf8;box-shadow:0 0 10px rgba(56,189,248,.6);pointer-events:none;left:-60px;top:-60px;transition:left .05s linear,top .05s linear';
    document.documentElement.appendChild(c);
    addEventListener('mousemove',e=>{c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';},true);
    addEventListener('mousedown',e=>{const r=document.createElement('div');r.style.cssText='position:fixed;z-index:2147483646;left:'+e.clientX+'px;top:'+e.clientY+'px;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:rgba(56,189,248,.55);pointer-events:none;transition:all .45s ease-out';document.documentElement.appendChild(r);requestAnimationFrame(()=>{r.style.width='46px';r.style.height='46px';r.style.margin='-23px 0 0 -23px';r.style.opacity='0';});setTimeout(()=>r.remove(),460);},true);
  };
  if (document.documentElement) mk(); else addEventListener('DOMContentLoaded', mk);
})();`;

export async function record({ title, scenario }) {
  const ORIGIN = process.env.QA_APP_ORIGIN || "http://localhost:4399";
  const EMAIL = process.env.QA_EMAIL;
  const PASSWORD = process.env.QA_PASSWORD;
  const TITLE = process.env.QA_TITLE || title || "Krafters QA";
  const OUT = process.env.QA_OUT || join(process.cwd(), "out/qa-desktop.mp4");
  const VIEWPORT = (process.env.QA_VIEWPORT || "desktop").toLowerCase();
  const DB_URL =
    process.env.QA_DB_URL ||
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const FFMPEG =
    process.env.FFMPEG_PATH ||
    (() => {
      try {
        return createRequire(import.meta.url)("ffmpeg-static");
      } catch {
        return "ffmpeg";
      }
    })();

  if (!EMAIL || !PASSWORD) {
    console.error("QA_EMAIL / QA_PASSWORD are required.");
    process.exit(1);
  }

  const profile = PROFILES[VIEWPORT] || PROFILES.desktop;
  const FRAME = { ...profile.frame, app: profile.app };
  const APP = profile.app;
  const EMULATE = profile.emulate;
  const HARNESS_URL = `${ORIGIN}/__qa_harness`;

  // Local Private Network Access checks block the iframe app's localhost chunks
  // → hydration never runs. Disable them.
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
    ],
  });

  // 1) Authenticate once (unrecorded) → storageState.
  const authCtx = await browser.newContext({ viewport: profile.frame });
  const authPage = await authCtx.newPage();
  await authPage.goto(`${ORIGIN}/signin`, { waitUntil: "domcontentloaded" });
  await authPage.fill("input[name=email]", EMAIL);
  await authPage.fill("input[name=password]", PASSWORD);
  await authPage.click('button:has-text("Sign in")');
  await authPage.waitForURL((u) => !u.pathname.includes("/signin"), { timeout: 30000 });
  const storageState = await authCtx.storageState();
  await authCtx.close();

  // 2) Recorded context: composed frame, shared session.
  const videoDir = mkdtempSync(join(tmpdir(), "qa-video-"));
  const ctx = await browser.newContext({
    viewport: profile.frame,
    deviceScaleFactor: 1,
    storageState,
    recordVideo: { dir: videoDir, size: profile.frame },
    ...(EMULATE ? { isMobile: EMULATE.isMobile, hasTouch: EMULATE.hasTouch, userAgent: EMULATE.userAgent } : {}),
  });
  await ctx.addInitScript(CURSOR_INIT);

  let page;
  const netLog = (resp) => {
    try {
      const req = resp.request();
      const rt = req.resourceType();
      if ((rt !== "xhr" && rt !== "fetch") || !page) return;
      const u = new URL(req.url());
      let path = u.pathname;
      // Drop chatty RSC route-poll refreshes + framework/static traffic.
      const isRsc =
        u.search.includes("_rsc") ||
        (req.method() === "GET" && path.includes("/deliverables/"));
      if (path.startsWith("/_next") || path.includes("favicon") || isRsc) return;
      if (path.length > 38) path = "…" + path.slice(-37);
      const cls = "s" + String(resp.status())[0];
      page
        .evaluate(
          ([m, s, p, c]) => {
            const log = document.getElementById("log");
            if (!log) return;
            const row = document.createElement("div");
            row.className = "row net";
            row.innerHTML = `<span class="badge ${c}">${s}</span><span class="method">${m}</span>${p}`;
            log.appendChild(row);
            while (log.childElementCount > 40) log.removeChild(log.firstChild);
          },
          [req.method(), resp.status(), path, cls],
        )
        .catch(() => {});
    } catch {
      /* ignore */
    }
  };
  ctx.on("response", netLog);

  // Serve the same-origin harness; strip framing blockers off app documents.
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    if (req.url() === HARNESS_URL)
      return route.fulfill({ contentType: "text/html", body: harnessHtml(FRAME) });
    if (req.resourceType() === "document") {
      try {
        const resp = await route.fetch();
        const headers = { ...resp.headers() };
        delete headers["x-frame-options"];
        delete headers["content-security-policy"];
        delete headers["content-security-policy-report-only"];
        return route.fulfill({ response: resp, headers });
      } catch {
        return route.continue();
      }
    }
    return route.continue();
  });

  page = await ctx.newPage();
  await page.goto(HARNESS_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => {
    document.getElementById("title").textContent = t;
  }, TITLE);

  const line = (cls, text) =>
    page.evaluate(
      ([c, t]) => {
        const log = document.getElementById("log");
        const row = document.createElement("div");
        row.className = "row " + c;
        row.textContent = t;
        log.appendChild(row);
        while (log.childElementCount > 40) log.removeChild(log.firstChild);
      },
      [cls, text],
    );
  const step = (t) => line("step", "▸ " + t);
  const ok = (t) => line("ok", "✓ " + t);
  const note = (t) => line("note", "  " + t);
  const warn = (t) => line("warn", "⚠ " + t);

  const app = page.frameLocator("#app");

  async function moveTo(locator, { click = false } = {}) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("element not visible");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(Math.min(x, FRAME.width - 4), Math.min(y, FRAME.height - 4), { steps: 28 });
    await sleep(380);
    if (click) {
      try {
        await locator.click({ timeout: 4000 });
      } catch {
        await locator.evaluate((el) => el.click());
      }
      await sleep(70);
    }
    return { x, y };
  }

  // Await React hydration on a locator — until its fiber attaches, onClick is a
  // no-op (the #1 reason a headless run records a dead page). Polls ~12s.
  async function hydrate(locator) {
    for (let i = 0; i < 40; i++) {
      const ready = await locator
        .evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$")))
        .catch(() => false);
      if (ready) return true;
      await sleep(300);
    }
    return false;
  }

  // Point the app iframe at a path and wait until it's interactive. `ready` is a
  // selector that must exist + be hydrated before the scenario drives clicks.
  async function navTo(path, { ready = "body", timeout = 30000 } = {}) {
    await page.evaluate(
      ([o, p]) => {
        document.getElementById("app").src = o + p;
      },
      [ORIGIN, path],
    );
    const r = app.locator(ready).first();
    await r.waitFor({ timeout });
    await hydrate(r);
  }

  function psql(sql) {
    return execFileSync("psql", [DB_URL, "-At", "-c", sql], { encoding: "utf8" }).trim();
  }

  // The embedded app's Frame (the first child frame of the harness page). Element
  // discovery and any frame-level evaluate run against this, not the top page.
  const appFrame = () =>
    page.frames().find((f) => f.parentFrame() === page.mainFrame()) ?? page.mainFrame();

  // Discover the actionable elements in the app (DOM/a11y, no screenshot) — each
  // with a paste-ready Playwright locator. `discover()` maps everything; `find()`
  // returns the best match for a free-text query.
  const discover = (opts) => mapInteractables(appFrame(), opts);
  const find = (query, opts) => findInteractable(appFrame(), query, opts);

  const ctxObj = {
    page,
    app,
    appFrame,
    ORIGIN,
    FRAME,
    APP,
    sleep,
    line,
    step,
    ok,
    note,
    warn,
    moveTo,
    navTo,
    hydrate,
    psql,
    discover,
    find,
  };

  try {
    await scenario(ctxObj);
  } finally {
    await page.close();
    const rawPath = await page.video().path();
    await ctx.close();
    await browser.close();

    execFileSync(
      FFMPEG,
      ["-y", "-i", rawPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-preset", "veryfast", "-movflags", "+faststart", OUT],
      { stdio: "ignore" },
    );

    // Optional 3x3 contact sheet for one-glance verification of the whole run.
    let sheet = null;
    if (process.env.QA_CONTACTSHEET === "1") {
      sheet = OUT.replace(/\.mp4$/, "-sheet.png");
      try {
        execFileSync(
          FFMPEG,
          ["-y", "-i", OUT, "-vf", "fps=1/3,scale=520:-1,tile=3x3", "-frames:v", "1", sheet],
          { stdio: "ignore" },
        );
      } catch {
        sheet = null;
      }
    }

    const mb = Number((statSync(OUT).size / 1048576).toFixed(2));
    console.log(JSON.stringify({ out: OUT, sizeMB: mb, sheet }));
    for (const f of readdirSync(videoDir)) {
      try {
        execFileSync("rm", ["-f", join(videoDir, f)]);
      } catch {
        /* ignore */
      }
    }
  }
}
