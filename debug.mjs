import { chromium } from "playwright";

const ORIGIN = "http://localhost:4321";
const TARGET = "/w/krafters-demo";
const HARNESS_URL = `${ORIGIN}/__qa_harness`;
const HARNESS_HTML = `<!doctype html><body style="margin:0"><iframe id="app" style="width:1280px;height:800px;border:0"></iframe></body>`;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights",
  ],
});
const authCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ap = await authCtx.newPage();
await ap.goto(`${ORIGIN}/signin`, { waitUntil: "domcontentloaded" });
await ap.fill("input[name=email]", "dev@krafters.local");
await ap.fill("input[name=password]", "dev-password-123!");
await ap.click('button:has-text("Sign in")');
await ap.waitForURL((u) => !u.pathname.includes("/signin"), { timeout: 30000 });
const storageState = await authCtx.storageState();
await authCtx.close();

const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState });
await ctx.route("**/*", async (route) => {
  const req = route.request();
  if (req.url() === HARNESS_URL) return route.fulfill({ contentType: "text/html", body: HARNESS_HTML });
  if (req.resourceType() === "document") {
    try {
      const resp = await route.fetch();
      const headers = { ...resp.headers() };
      delete headers["x-frame-options"];
      delete headers["content-security-policy"];
      delete headers["content-security-policy-report-only"];
      return route.fulfill({ response: resp, headers });
    } catch { return route.continue(); }
  }
  return route.continue();
});

const page = await ctx.newPage();
page.on("console", (m) => console.log("[top console]", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[top pageerror]", e.message.slice(0, 300)));
page.on("frameattached", () => console.log("[frame attached]"));

await page.goto(HARNESS_URL, { waitUntil: "domcontentloaded" });
await page.evaluate(([o, p]) => { document.getElementById("app").src = o + p; }, [ORIGIN, TARGET]);

const app = page.frameLocator("#app");
await app.locator('[data-testid="week-board"]').waitFor({ timeout: 30000 });
console.log("week-board visible");

// Find the app frame to attach error listeners.
const appFrame = page.frames().find((f) => f.url().includes("/w/"));
console.log("app frame url:", appFrame?.url());

await page.waitForTimeout(2500);

// Is the open-report button present, and does a click open the modal?
const btn = app.locator('[data-testid="open-report"]');
console.log("open-report count:", await btn.count());
await btn.click({ timeout: 5000 }).then(() => console.log("clicked open-report")).catch((e) => console.log("click err", e.message));
await page.waitForTimeout(1500);
console.log("modal count after click:", await app.locator(".modal").count());

// Probe hydration: does a fresh React-driven state change work? Check if the
// button has a React fiber attached (hydrated) by inspecting the iframe doc.
const hydrationInfo = await appFrame.evaluate(() => {
  const btn = document.querySelector('[data-testid="open-report"]');
  const keys = btn ? Object.keys(btn).filter((k) => k.startsWith("__react")) : [];
  return {
    hasButton: !!btn,
    reactKeys: keys,
    bodyHasModal: !!document.querySelector(".modal"),
    nextData: !!document.getElementById("__NEXT_DATA__"),
    scripts: document.querySelectorAll("script[src]").length,
  };
});
console.log("hydration probe:", JSON.stringify(hydrationInfo));

await browser.close();
