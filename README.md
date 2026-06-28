# @krafters/qa-engine

Record **composed 16:9 QA walkthrough videos** of a web app with Playwright, and
drive the app through the **DOM / accessibility tree — never screenshots**.

Each frame is a single 16:9 canvas: a live **console panel** on the left
(▸ steps, ✓ assertions, real network rows) and the **real app embedded
same-origin** on the right, with a visible cursor and human-like navigation. The
output is an H.264 `.mp4` under 50 MB.

> Status: early (`0.1.0`). The recording engine is in use; the public API and CLI
> are still settling. Extracted from Krafters' internal QA tooling and being made
> generic + open source.

## Why this exists

QA walkthroughs usually break in two ways, and this engine is built to avoid both:

- **Authoring by screenshot is slow and fragile.** Playwright drives the real
  DOM — it never needs a pixel. Instead of eyeballing a screenshot to find a
  button, you ask the page for its **interactable elements** and get a
  ready-to-use locator back. One round-trip, deterministic, no vision.
- **Embedding a real app for recording is full of traps** — third-party-frame
  cookies, framing headers, headless hydration, local-network blocks. The engine
  bakes in the fixes (same-origin harness, header stripping, hydration waits,
  Chromium flags) so a recording isn't a dead page.

## What it solves

- One composed **16:9 video per viewport** (desktop / mobile), ready to attach to
  a review.
- **Screenshot-free element discovery** (`mapInteractables`) — the headline
  feature: a text catalog of actionable elements, each with a paste-ready
  Playwright locator.
- **Same-origin auth** that survives inside the embedded iframe.
- **Real network + step log** rendered into the video, so the recording explains
  itself.
- H.264 transcode kept **under 50 MB** for easy upload.

## Install

```sh
npm install @krafters/qa-engine
```

Playwright downloads its pinned Chromium automatically on install (and the engine
self-heals if it's missing). The only one-time cost is that ~150 MB browser
download on a fresh machine. `ffmpeg` ships via `ffmpeg-static` — nothing to
install by hand.

> Record against a **production build** of the app under test. `next dev` (and
> most HMR dev servers) don't hydrate reliably in headless Chromium, so clicks
> become no-ops.

## Element discovery (no screenshots)

The fast way to author or drive a flow. Point it at a Playwright `Page` or
`Frame` and get back the actionable elements with locators you can use directly:

```js
import { chromium } from "playwright";
import { mapInteractables, findInteractable } from "@krafters/qa-engine";

const page = await (await chromium.launch()).newPage();
await page.goto("https://example.com");

const elements = await mapInteractables(page);
// [
//   { role: "button", name: "Toggle chat", testid: null,
//     selector: '[aria-label="Toggle chat"]',
//     locator: 'getByRole("button", { name: "Toggle chat" })', visible: true, ... },
//   { role: "textbox", name: "Email", selector: "#email",
//     locator: 'getByRole("textbox", { name: "Email" })', ... },
//   ...
// ]

// Or find the best match for a free-text query:
const send = await findInteractable(page, "send");
await page.locator(send.selector).click(); // or use the `locator` expression
```

Each entry has: `role`, `name` (accessible name), `testid`, `tag`, `type`,
`visible`, `enabled`, a best-effort CSS `selector`, and a recommended Playwright
`locator` expression. Pass `{ includeHidden: true }` to also list off-screen
elements.

**Tip:** add `data-testid` to the controls you test most — discovery prefers it
and the resulting locators are the most stable.

## Recording a walkthrough

Write a small scenario and hand it to `record()`:

```js
import { record } from "@krafters/qa-engine";

record({
  title: "Sign in and open the dashboard",
  scenario: async (t) => {
    await t.navTo("/signin", { ready: "input[name=email]" });
    await t.step("type credentials");
    await t.moveTo(t.app.getByLabel("Email"), { click: true });
    // discover what's on screen instead of guessing:
    const map = await t.discover();
    t.note(`${map.length} interactable elements`);
    await t.ok("signed in");
  },
});
```

The scenario context `t` includes:

| | |
|---|---|
| `t.app` | `frameLocator("#app")` — the embedded app |
| `t.appFrame()` | the app's Playwright `Frame` |
| `t.discover(opts)` | map interactable elements (DOM/a11y) in the app |
| `t.find(query)` | best interactable matching free text |
| `t.navTo(path,{ready})` | point the iframe at a path + await hydration |
| `t.moveTo(locator,{click})` | human-like cursor move + reliable click |
| `t.step/ok/note/warn` | write to the console panel (cyan/green/…) |
| `t.hydrate(locator)` | await a locator's React fiber (interactive) |
| `t.psql(sql)` | local Postgres one-liner (deterministic baselines) |

Configure via env: `QA_APP_ORIGIN`, `QA_EMAIL`, `QA_PASSWORD`,
`QA_VIEWPORT` (`desktop`\|`mobile`), `QA_TITLE`, `QA_OUT`, `QA_DB_URL`,
`QA_CONTACTSHEET=1`, `FFMPEG_PATH`.

See [`examples/krafters`](./examples/krafters) for a real scenario and the
`serve.sh` / `run.sh` helpers (build a prod server once, re-record fast).

## Authoring guidelines (every scenario)

These are the defaults a QA walkthrough should always follow — the engine bakes
in the motion, the scenario brings the coverage:

- **Natural pointer, never a teleport.** The engine moves the cursor along a
  curved, variable-speed path and leaves a fading **motion trail**, with a short
  settle/hover before each click. Reach controls with `t.moveTo(locator,{click})`
  — don't snap straight to a bare `locator.click()`.
- **Move like a human.** Type into fields character-by-character
  (`locator.pressSequentially(text, { delay: 90 })`), scroll to reveal content,
  and `t.sleep` between beats so the viewer can follow. Compress any wait > 5s.
- **Cover everything the change touches.** For each new or changed screen, state,
  and interactive control the deliverable introduces, drive it on **both desktop
  and mobile**. Record the meaningful states — empty / valid / loading / error /
  expired — not just the happy path.
- **Explain, don't just show.** One green `t.ok` per milestone, and surface where
  an action leads (e.g. log the resolved link `href`) so the recording narrates
  the behaviour under test.
- **Make it reproducible.** Reset seed rows at the start with `t.psql` so every
  run — and the second viewport — replays the same flow deterministically.

## Gotchas (already handled by the engine)

- **Prod build required** — dev/HMR doesn't hydrate headless; the engine waits on
  each element's React fiber before driving it.
- **Same-origin harness** — the harness HTML is served from the app's own origin
  so the login cookie sticks inside the iframe; framing headers are stripped.
- **Local Network Access** — Chromium is launched with the flags that let the
  embedded app reach `localhost` services.
- **Browser pin** — the Chromium revision is pinned by the `playwright` version,
  so recordings are reproducible across machines.

## License

MIT © Krafters
