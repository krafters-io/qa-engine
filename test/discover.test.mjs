import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mapInteractables, findInteractable } from "../lib/discover.mjs";

/**
 * Element discovery runs against a real DOM, so the test drives a tiny inline
 * page through Playwright (no app, no server) and asserts the catalog + the
 * ready-to-use locator strings.
 */

const HTML = `<!doctype html><html><body>
  <button aria-label="Toggle chat">💬</button>
  <button data-testid="composer-send">Send</button>
  <a href="/docs">Open docs</a>
  <label for="email">Email</label>
  <input id="email" type="text" />
  <input type="hidden" name="csrf" value="x" />
  <button style="display:none">Ghost</button>
</body></html>`;

let browser;
let page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(HTML);
});

after(async () => {
  await browser.close();
});

test("maps visible interactables with ready locators", async () => {
  const els = await mapInteractables(page);
  const byName = (n) => els.find((e) => e.name === n);

  const toggle = byName("Toggle chat");
  assert.ok(toggle, "icon button found by aria-label");
  assert.equal(toggle.role, "button");
  assert.equal(toggle.locator, 'getByRole("button", { name: "Toggle chat" })');

  const send = els.find((e) => e.testid === "composer-send");
  assert.ok(send, "testid element found");
  assert.equal(send.locator, 'getByTestId("composer-send")');

  const link = byName("Open docs");
  assert.ok(link, "link found");
  assert.equal(link.role, "link");

  const email = byName("Email");
  assert.ok(email, "input found by its <label>");
  assert.equal(email.role, "textbox");
  assert.equal(email.selector, "#email");
});

test("excludes hidden elements by default, includes with includeHidden", async () => {
  const visible = await mapInteractables(page);
  assert.equal(
    visible.find((e) => e.name === "Ghost"),
    undefined,
    "display:none button excluded",
  );
  assert.equal(
    visible.find((e) => e.tag === "input" && e.type === "hidden"),
    undefined,
    "type=hidden input excluded",
  );

  const all = await mapInteractables(page, { includeHidden: true });
  assert.ok(
    all.find((e) => e.name === "Ghost"),
    "hidden button surfaced with includeHidden",
  );
});

test("findInteractable matches free text", async () => {
  const hit = await findInteractable(page, "docs");
  assert.ok(hit);
  assert.equal(hit.role, "link");
  assert.equal(await findInteractable(page, "nothing-matches-this"), null);
});
