/**
 * QA scenario — Deliverable 15016a58
 * "Badge de contagem de comentários no botão de chat do deliverable"
 *
 * Proves the new ChatCountBubble overlaid on the deliverable chat toggle button:
 *   - shows the total comment count, visible with the drawer closed AND open
 *   - updates within the 5s polling window when a comment is added
 *   - caps at "99+"
 *   - renders nothing (no badge) on a deliverable with zero comments
 *   - the count is exposed through the button's aria-label
 *
 * Both viewports, against a PROD build of the worktree.
 *
 *   QA_APP_DIR=<worktree> QA_VIEWPORT=desktop \
 *   QA_SCENARIO=examples/krafters/record-chat-count-badge.mjs ./run.sh
 */

import { record } from "../../index.mjs";
import * as k from "./krafters.mjs";

// Seed deliverable that ships with 10 comments; zero-comment deliverable for the
// empty case. Both live in krafters-demo.
const ID = process.env.QA_DELIVERABLE_ID || "0d3f0000-0000-4000-8000-0000000000d1";
const EMPTY_ID = process.env.QA_EMPTY_ID || "dc2e9ceb-231d-4b0a-93cc-473a9ece80a8";
const DETAIL = `/w/krafters-demo/deliverables/${ID}`;
const EMPTY_DETAIL = `/w/krafters-demo/deliverables/${EMPTY_ID}`;

const MARK = "[qa-badge]";

// The bubble is aria-hidden; read it as the span sibling of the toggle button.
const BUBBLE = 'button[aria-pressed] + span[aria-hidden="true"]';

record({
  title:
    process.env.QA_TITLE ||
    "Feature · Badge de contagem de comentários no botão de chat",
  scenario: async (t) => {
    // ── Deterministic baseline: strip any QA-injected comments so both this run
    //    and the second viewport start from the same real count. ──────────────
    t.psql(`DELETE FROM deliverable_comments WHERE deliverable_id='${ID}' AND body LIKE '${MARK}%';`);
    const base = Number(
      (await t.psql(`SELECT count(*) FROM deliverable_comments WHERE deliverable_id='${ID}';`)) ||
        0,
    );
    await t.note(`origin ${t.ORIGIN}`);
    await t.note(`deliverable ${ID.slice(0, 8)} · base comments = ${base}`);

    const bubbleText = () =>
      t.app.locator(BUBBLE).innerText().then((s) => s.trim()).catch(() => "");
    const toggleAria = () =>
      t.app.locator("button[aria-pressed]").getAttribute("aria-label").catch(() => "");

    // ── Scene 1: badge on the closed drawer ───────────────────────────────────
    await k.openDeliverable(t, DETAIL);
    await t.app.getByRole("button", { name: "Edit", exact: true }).waitFor({ timeout: 10000 });
    await t.sleep(700);

    await t.step("a count bubble sits on the chat toggle button (drawer closed)");
    await t.moveTo(t.app.locator(BUBBLE));
    const shown = await bubbleText();
    if (shown === String(base)) await t.ok(`bubble shows the total comment count (${shown})`);
    else await t.warn(`bubble shows "${shown}", expected "${base}"`);

    const aria = await toggleAria();
    if (/\d+\s+comments?/.test(aria)) await t.ok(`screen readers hear the count · aria-label = "${aria}"`);
    else await t.warn(`aria-label missing the count: "${aria}"`);
    await t.sleep(900);

    // ── Scene 2: badge stays while the drawer is open ─────────────────────────
    const w = await k.openDrawer(t);
    await t.note(`drawer width ${w}px`);
    await t.step("badge remains visible with the chat drawer open");
    if ((await bubbleText()) === String(base))
      await t.ok("count bubble stays put whether the chat is open or closed");
    else await t.warn("badge disappeared when the drawer opened");
    await t.sleep(1000);

    // ── Scene 3: live update within the 5s polling window ─────────────────────
    await t.step("add a comment — the badge ticks up within ~5s (polling)");
    t.psql(
      `INSERT INTO deliverable_comments (deliverable_id, workspace_id, author_id, body, source)
       SELECT d.id, d.workspace_id,
              (SELECT author_id FROM deliverable_comments WHERE deliverable_id=d.id LIMIT 1),
              '${MARK} nova mensagem', 'user'
       FROM deliverables d WHERE d.id='${ID}';`,
    );
    let updated = "";
    for (let i = 0; i < 20 && updated !== String(base + 1); i++) {
      await t.sleep(400); // poll up to ~8s; the app refreshes every 5s
      updated = await bubbleText();
    }
    if (updated === String(base + 1))
      await t.ok(`badge updated to ${updated} without a manual reload`);
    else await t.warn(`badge did not reach ${base + 1} (saw "${updated}")`);
    await t.moveTo(t.app.locator(BUBBLE));
    await t.sleep(1200);

    // ── Scene 4: the 99+ cap ──────────────────────────────────────────────────
    await t.step("counts above 99 collapse to 99+");
    const need = 100 - (base + 1);
    if (need > 0) {
      t.psql(
        `INSERT INTO deliverable_comments (deliverable_id, workspace_id, author_id, body, source)
         SELECT d.id, d.workspace_id,
                (SELECT author_id FROM deliverable_comments WHERE deliverable_id=d.id LIMIT 1),
                '${MARK} bulk '||g, 'user'
         FROM deliverables d CROSS JOIN generate_series(1, ${need}) g WHERE d.id='${ID}';`,
      );
    }
    await k.openDeliverable(t, DETAIL); // reload so the server re-aggregates the count
    await t.app.getByRole("button", { name: "Edit", exact: true }).waitFor({ timeout: 10000 });
    let capped = "";
    for (let i = 0; i < 15 && capped !== "99+"; i++) {
      await t.sleep(400);
      capped = await bubbleText();
    }
    await t.moveTo(t.app.locator(BUBBLE));
    if (capped === "99+") await t.ok("100 comments render as 99+");
    else await t.warn(`expected "99+", saw "${capped}"`);
    await t.sleep(1400);

    // ── Cleanup the injected comments before the empty-state scene ────────────
    t.psql(`DELETE FROM deliverable_comments WHERE deliverable_id='${ID}' AND body LIKE '${MARK}%';`);

    // ── Scene 5: no comments → no badge ───────────────────────────────────────
    await t.step("a deliverable with zero comments shows no badge at all");
    await k.openDeliverable(t, EMPTY_DETAIL);
    await t.app.getByRole("button", { name: "Edit", exact: true }).waitFor({ timeout: 10000 });
    await t.sleep(800);
    await t.moveTo(t.app.locator("button[aria-pressed]"));
    const emptyCount = await t.app.locator(BUBBLE).count();
    if (emptyCount === 0) await t.ok("no comments → the bubble renders nothing (clean button)");
    else await t.warn(`empty deliverable still shows a bubble (${emptyCount})`);
    await t.sleep(1400);
  },
}).catch((e) => {
  console.error("QA RUN FAILED:", e.message);
  process.exit(1);
});
