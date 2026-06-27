/**
 * @krafters/qa-engine — public API.
 *
 * A generic Playwright harness that records a composed 16:9 QA walkthrough
 * (live console panel on the left, the real app embedded same-origin on the
 * right, visible cursor) and drives the app through the DOM/accessibility tree —
 * never screenshots.
 *
 *   import { record, mapInteractables } from "@krafters/qa-engine";
 */

export { record } from "./lib/harness.mjs";
export { mapInteractables, findInteractable } from "./lib/discover.mjs";
