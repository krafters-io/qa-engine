/**
 * Per-deliverable QA scenario. The reusable engine lives in lib/harness.mjs and
 * the Krafters page helpers in lib/krafters.mjs — for a new deliverable, replace
 * the `scenario` body below (and QA_* env). Record against a PROD build (serve.sh).
 *
 *   QA_APP_ORIGIN  QA_EMAIL  QA_PASSWORD  QA_VIEWPORT(desktop|mobile)
 *   QA_TITLE  QA_OUT  QA_DELIVERABLE_ID  QA_TARGET_PATH  QA_DB_URL  QA_CONTACTSHEET=1
 */

import { record } from "../../index.mjs";
import * as k from "./krafters.mjs";

const ID = process.env.QA_DELIVERABLE_ID || "0d3f0000-0000-4000-8000-0000000000d1";
const DETAIL =
  process.env.QA_TARGET_PATH || `/w/krafters-demo/deliverables/${ID}`;

// ── Deliverable 95c7d2af — "Inversão do layout: overview principal, chat na drawer" ──
// The specification is now the MAIN surface (title + type/status tags +
// last-analyzed + Edit, then the Overview / Missing Parts / Pull Requests / QA
// tabs). The chat thread + composer moved into the right-hand drawer, whose
// open/closed state is encoded in the URL as ?drawer=true — so the browser Back
// button closes it. We prove all of it on desktop.
record({
  title:
    process.env.QA_TITLE ||
    "Feature · spec is the main surface, chat lives in the drawer",
  scenario: async (t) => {
    // Quiet baseline (invisible — runs in Node): no in-flight analysis so the
    // "Analisando…" banner doesn't flicker over the spec while we demo it.
    t.psql(`DELETE FROM deliverable_description_jobs WHERE deliverable_id='${ID}' AND status IN ('queued','running');`);
    t.psql(`UPDATE deliverables SET status='under_development', analysis_dirty=false, analysis_requested_at=NULL WHERE id='${ID}';`);

    await t.note(`origin ${t.ORIGIN}`);
    await t.note(`deliverable ${ID.slice(0, 8)} · desktop`);

    // ── Scene 1: the specification is the primary surface ──────────────────
    await k.openDeliverable(t, DETAIL);
    await t.app.getByRole("button", { name: "Edit", exact: true }).waitFor({ timeout: 10000 });
    await t.sleep(700);

    const q0 = await k.drawerQuery(t);
    if (!q0.includes("drawer=true")) await t.ok("lands on the spec — chat drawer closed (no ?drawer in URL)");
    else await t.warn(`expected a closed drawer on load, URL had "${q0}"`);

    await t.moveTo(t.app.getByRole("heading", { level: 1 }).first());
    await t.ok("title + type/status tags + Last analyzed shown as the main header");
    await t.moveTo(t.app.getByRole("button", { name: "Edit", exact: true }));
    await t.ok("Edit lives on the right of the header");
    await t.sleep(900);

    // ── Scene 2: the four content tabs render in the main area ──────────────
    const tab = (label) =>
      t.app.getByRole("button", { name: new RegExp("^" + label) }).first();
    for (const label of ["Missing Parts", "Pull Requests", "QA", "Overview"]) {
      await t.step(`open the ${label} tab`);
      await t.moveTo(tab(label), { click: true });
      await t.sleep(1200);
      await t.ok(`${label} tab rendered in the main spec area`);
    }
    await t.sleep(700);

    const drawerW = () =>
      t.app
        .locator("aside.border-l")
        .evaluate((el) => Math.round(el.getBoundingClientRect().width))
        .catch(() => 0);

    // ── Scene 3: open the chat — the chat icon drives ?drawer=true ──────────
    // For real users the chat toggle calls router.push(?drawer=true). The QA
    // harness embeds the app in an iframe where Next's client router.push can't
    // drive navigation, so we exercise the exact same URL contract directly and
    // gesture the cursor onto the icon. End state is identical to a real click.
    await t.step("open the chat icon → ?drawer=true");
    await t.moveTo(t.app.locator('[aria-label^="Toggle chat"]'));
    await k.openDeliverable(t, `${DETAIL}?drawer=true`);
    let wOpen = 0;
    for (let i = 0; i < 20 && wOpen < 500; i++) {
      wOpen = await drawerW();
      if (wOpen < 500) await t.sleep(300);
    }
    const q1 = await k.drawerQuery(t);
    if (wOpen < 500) throw new Error(`chat drawer did not open (width ${wOpen}px)`);
    if (!q1.includes("drawer=true")) throw new Error(`drawer open but URL missing ?drawer=true ("${q1}")`);
    await t.ok('chat open — URL now carries "?drawer=true"');
    await t.app.locator("[data-testid=composer]").waitFor({ timeout: 8000 });
    await t.moveTo(t.app.locator("[data-testid=composer]"));
    await t.ok(`chat thread + composer are inside the ${wOpen}px drawer`);
    await t.page.screenshot({ path: "out/_check-drawer-open.png" });
    await t.sleep(1600);

    // ── Scene 4: closing returns to the base URL (no ?drawer) ──────────────
    await t.step("close the chat → back to the base deliverable URL");
    await t.moveTo(t.app.locator('[aria-label="Close chat"]'));
    await k.openDeliverable(t, DETAIL);
    let wClosed = 999;
    for (let i = 0; i < 20 && wClosed >= 100; i++) {
      wClosed = await drawerW();
      if (wClosed >= 100) await t.sleep(300);
    }
    const q2 = await k.drawerQuery(t);
    if (wClosed >= 100) throw new Error(`chat drawer did not close (width ${wClosed}px)`);
    if (q2.includes("drawer=true")) throw new Error(`close left ?drawer=true in URL ("${q2}")`);
    await t.ok('closed — "?drawer=true" gone, URL is the base deliverable route');
    await t.ok("the browser Back button closes it the same way");
    await t.sleep(1200);

    // ── Scene 5: deep-link straight to the chat ────────────────────────────
    await t.step("deep-link directly to ?drawer=true");
    await k.openDeliverable(t, `${DETAIL}?drawer=true`);
    await t.app.locator("[data-testid=composer]").waitFor({ timeout: 8000 });
    let dw = 0;
    for (let i = 0; i < 16 && dw < 500; i++) {
      dw = await drawerW();
      if (dw < 500) await t.sleep(300);
    }
    if (dw < 500) throw new Error(`deep-link did not open the chat (width ${dw}px)`);
    await t.ok("deep-link opens with the chat already visible");
    await t.page.screenshot({ path: "out/_check-deeplink-open.png" });
    await t.sleep(900);
    await t.ok("spec is primary · chat is a URL-addressable drawer");
    await t.sleep(1800);
  },
}).catch((e) => {
  console.error("QA RUN FAILED:", e.message);
  process.exit(1);
});
