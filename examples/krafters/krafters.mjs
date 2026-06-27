/**
 * Krafters page-object helpers for QA scenarios. Thin wrappers over the harness
 * ctx (`t`) so a per-deliverable scenario reads as a script, with the hard-won
 * gotchas (hydration wait, off-screen drawer, modal selectors) baked in.
 *
 * Import alongside the engine:
 *   import { record } from "./lib/harness.mjs";
 *   import * as k from "./lib/krafters.mjs";
 */

// Open a deliverable detail page in the iframe and wait until it's interactive.
export async function openDeliverable(t, path) {
  await t.step(`open the deliverable ${path}`);
  // The specification is the main surface now; the chat toggle is the stable
  // chrome control that exists on every deliverable detail view.
  await t.navTo(path, { ready: '[aria-label="Toggle chat"]' });
  await t.sleep(1400);
  await t.ok("deliverable opened");
}

// Open the right-hand CHAT drawer (the thread + composer live here now). The
// drawer animates 0 → 620px and ?drawer=true is pushed to the URL. Click ONCE
// then POLL — re-clicking a toggle that's mid-navigation would close it again
// (the prod RSC push can take >1s inside the iframe). Only re-click after a long
// wait, max 3 attempts. Returns the final width.
export async function openDrawer(t) {
  await t.step("open the chat drawer");
  const drawer = t.app.locator("aside.border-l");
  const w = () => drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width)).catch(() => 0);
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await w()) >= 500) break;
    await t.moveTo(t.app.locator('[aria-label="Toggle chat"]'), { click: true });
    for (let i = 0; i < 16 && (await w()) < 500; i++) await t.sleep(300); // poll ~4.8s
  }
  return w();
}

// Close the chat drawer via its header close control. Same click-once-then-poll
// discipline so we never accidentally re-open it.
export async function closeDrawer(t) {
  await t.step("close the chat drawer");
  const drawer = t.app.locator("aside.border-l");
  const w = () => drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width)).catch(() => 0);
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await w()) < 100) break;
    await t.moveTo(t.app.locator('[aria-label="Close chat"]'), { click: true });
    for (let i = 0; i < 16 && (await w()) >= 100; i++) await t.sleep(300);
  }
  return w();
}

// The chat drawer URL contract: ?drawer=true present (open) or absent (closed).
export function drawerQuery(t) {
  return t.app.locator("body").evaluate(() => window.location.search).catch(() => "");
}

// Press the browser Back button inside the app iframe. Defer the actual
// history.back() to a later tick so this evaluate() resolves BEFORE the
// navigation tears its own execution context down.
export async function browserBack(t) {
  await t.app
    .locator("body")
    .evaluate(() => window.setTimeout(() => window.history.back(), 50));
}

// Open the Edit modal; resolves once the status <select> is present.
export async function openEdit(t) {
  await t.step("open Edit");
  await t.moveTo(t.app.getByRole("button", { name: "Edit", exact: true }), { click: true });
  await t.app.locator("#edit-deliverable-status").waitFor({ timeout: 10000 });
}

export async function setStatus(t, value) {
  const sel = t.app.locator("#edit-deliverable-status");
  await t.moveTo(sel);
  await sel.selectOption(value);
  await t.sleep(600);
}

export async function fillDescription(t, text) {
  const box = t.app.locator("#edit-deliverable-description");
  await t.moveTo(box);
  await box.fill(text);
  await t.sleep(500);
}

export async function fillTitle(t, text) {
  const box = t.app.locator("#edit-deliverable-title");
  await t.moveTo(box);
  await box.fill(text);
  await t.sleep(500);
}

// Click Save and wait for the modal to close.
export async function save(t) {
  await t.step("Save");
  await t.moveTo(t.app.locator('button[type="submit"]:has-text("Save")'), { click: true });
  await t.app.locator("#edit-deliverable-status").waitFor({ state: "detached", timeout: 10000 });
}

// How many elements currently show the given (substring) text inside the app.
export function textCount(t, text) {
  return t.app.getByText(text).count();
}

export function bannerLocator(t, text = "Analisando o deliverable") {
  return t.app.getByText(text).first();
}
