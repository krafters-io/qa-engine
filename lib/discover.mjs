/**
 * DOM / accessibility element discovery.
 *
 * The slow, fragile way to author a browser scenario is to take a screenshot and
 * hunt for elements by eye. But Playwright drives the real DOM — it never needs a
 * pixel. `mapInteractables` runs a single in-page pass and returns a structured,
 * text-only catalog of the actionable elements (buttons, links, inputs, tabs,
 * anything with a test id), each with a READY-TO-USE Playwright locator string
 * (`getByRole`, `getByTestId`, …). The author (human or agent) reads that list and
 * acts immediately — no image, one round-trip, deterministic.
 *
 * `scope` is anything with `.evaluate()` — a Playwright Page or Frame (e.g. the
 * app iframe). The returned `locator` strings are meant to be used against that
 * same scope (`frame.getByRole(...)` / `frame.locator(selector)`).
 */

/**
 * @typedef {Object} Interactable
 * @property {string} role            Inferred ARIA role (button, link, textbox, …).
 * @property {string} name            Accessible name (best-effort).
 * @property {string|null} testid     data-testid, if present.
 * @property {string} tag             Lowercased tag name.
 * @property {string|null} type       input type, if applicable.
 * @property {boolean} visible        Rendered + non-zero box.
 * @property {boolean} enabled        Not disabled.
 * @property {string|null} selector   Best CSS selector (testid/id/aria-label), or null.
 * @property {string} locator         Recommended Playwright locator expression.
 */

/** The in-page scan. Defined as a plain function so it serializes into evaluate. */
function scan(opts) {
  const includeHidden = opts && opts.includeHidden;
  const limit = (opts && opts.limit) || 200;

  const cssEscape = (s) =>
    window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"');
  const jsStr = (s) => JSON.stringify(String(s));

  const isVisible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (!el.offsetParent && style.position !== "fixed") return false;
    return true;
  };

  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "button" || t === "submit" || t === "reset") return "button";
      if (t === "range") return "slider";
      if (["text", "search", "email", "url", "tel", "password", "number"].includes(t))
        return "textbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return "generic";
  };

  const labelText = (el) => {
    // <label for=id> or wrapping <label>
    if (el.id) {
      const lbl = document.querySelector(`label[for=${jsStr(el.id)}]`);
      if (lbl && lbl.textContent) return lbl.textContent.trim();
    }
    const wrap = el.closest("label");
    if (wrap && wrap.textContent) return wrap.textContent.trim();
    return "";
  };

  const accessibleName = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const parts = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => n.textContent.trim());
      if (parts.length) return parts.join(" ");
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].includes(t) && el.value) return el.value.trim();
      const lt = labelText(el);
      if (lt) return lt;
      if (el.placeholder) return el.placeholder.trim();
      return "";
    }
    if (tag === "textarea" || tag === "select") {
      const lt = labelText(el);
      if (lt) return lt;
      if (el.placeholder) return el.placeholder.trim();
      return "";
    }
    if (el.title) return el.title.trim();
    if (el.getAttribute("alt")) return el.getAttribute("alt").trim();
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    return txt.slice(0, 120);
  };

  const candidates = new Set();
  const sel =
    "button, a[href], input, textarea, select, [contenteditable=''], " +
    "[contenteditable='true'], [role='button'], [role='link'], [role='tab'], " +
    "[role='menuitem'], [role='checkbox'], [role='radio'], [role='switch'], " +
    "[role='combobox'], [role='textbox'], [data-testid]";
  document.querySelectorAll(sel).forEach((el) => candidates.add(el));

  const out = [];
  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    // Inputs of type hidden are never actionable.
    if (tag === "input" && (el.getAttribute("type") || "").toLowerCase() === "hidden")
      continue;
    const visible = isVisible(el);
    if (!visible && !includeHidden) continue;

    const testid =
      el.getAttribute("data-testid") ||
      el.getAttribute("data-test-id") ||
      el.getAttribute("data-test") ||
      null;
    const role = roleOf(el);
    const name = accessibleName(el);
    const type = el.getAttribute("type");
    const enabled = !(el.disabled || el.getAttribute("aria-disabled") === "true");
    const ariaLabel = el.getAttribute("aria-label");
    const placeholder = el.getAttribute("placeholder");

    // Best CSS selector (stable → less stable).
    let selector = null;
    if (testid) selector = `[data-testid="${cssEscape(testid)}"]`;
    else if (el.id) selector = `#${cssEscape(el.id)}`;
    else if (ariaLabel) selector = `[aria-label="${cssEscape(ariaLabel)}"]`;

    // Recommended Playwright locator expression (paste-ready).
    let locator;
    if (testid) locator = `getByTestId(${jsStr(testid)})`;
    else if (role !== "generic" && name)
      locator = `getByRole(${jsStr(role)}, { name: ${jsStr(name)} })`;
    else if (ariaLabel) locator = `locator(${jsStr(`[aria-label="${ariaLabel}"]`)})`;
    else if (placeholder) locator = `getByPlaceholder(${jsStr(placeholder)})`;
    else if (el.id) locator = `locator(${jsStr(`#${el.id}`)})`;
    else if (name && (role === "button" || role === "link"))
      locator = `getByText(${jsStr(name)})`;
    else locator = `locator(${jsStr(tag)})`;

    out.push({
      role,
      name,
      testid,
      tag,
      type,
      visible,
      enabled,
      selector,
      locator,
    });
    if (out.length >= limit) break;
  }

  // Visible first, then keep document order (Set preserves insertion order).
  out.sort((a, b) => Number(b.visible) - Number(a.visible));
  return out;
}

/**
 * Map the interactable elements in `scope` (a Playwright Page or Frame).
 * @param {{ evaluate: Function }} scope
 * @param {{ includeHidden?: boolean, limit?: number }} [opts]
 * @returns {Promise<Interactable[]>}
 */
export async function mapInteractables(scope, opts = {}) {
  if (!scope || typeof scope.evaluate !== "function") {
    throw new TypeError(
      "mapInteractables(scope): scope must be a Playwright Page or Frame",
    );
  }
  return scope.evaluate(scan, { includeHidden: !!opts.includeHidden, limit: opts.limit });
}

/**
 * Find the interactable that best matches a free-text query (case-insensitive
 * substring over name/testid/role). Returns null when nothing matches. Handy for
 * "click the thing that says X" without knowing the selector up front.
 * @param {{ evaluate: Function }} scope
 * @param {string} query
 * @param {{ includeHidden?: boolean }} [opts]
 * @returns {Promise<Interactable|null>}
 */
export async function findInteractable(scope, query, opts = {}) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return null;
  const all = await mapInteractables(scope, opts);
  const hay = (i) => `${i.name} ${i.testid ?? ""} ${i.role}`.toLowerCase();
  return (
    all.find((i) => i.visible && hay(i).includes(q)) ??
    all.find((i) => hay(i).includes(q)) ??
    null
  );
}
