---

# Spec: Flow Bulk Deleter — Delete Wizard (Side Panel Addition)

## 1. Overview

Add a **Delete All** wizard to the existing side panel, alongside the Download wizard from the previous spec. The delete wizard mirrors the three-phase approach of the reference console script: count all images by scrolling, delete every image batch top-to-bottom (confirming each Flow-native dialog programmatically), and re-count to verify. The side panel becomes a tabbed interface with two modes: **Download** and **Delete**.

---

## 2. Reference Script

Stored in `ref` in the repository (not loaded by the extension — documentation only).

```js
/**
 * Google Flow — Bulk Image Counter & Deleter (Console Script)
 *
 * Phase 1: Scrolls through the project, counts every generated image.
 * Phase 2: Deletes all image groups top-to-bottom, confirming each dialog.
 * Phase 3: Re-scrolls and re-counts to verify deletion.
 *
 * NOTE: Flow groups images by prompt batch. The Delete button removes
 * all images in a batch (e.g. 4 variants from one generation).
 * There is no per-image delete in the Flow UI — only per-batch.
 *
 * Usage: paste into DevTools console while on a Flow project page
 *        (either the project root or inside a collection).
 */
(async function FlowCountAndDelete() {
  "use strict";

  const SCROLL_PAUSE = 600;
  const SCROLL_STEP = 800;
  const DELETE_PAUSE = 1500;
  const DIALOG_WAIT = 800;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(msg) {
    console.log(
      `%c[FlowDel]%c ${msg}`,
      "color:#f87171;font-weight:bold",
      "color:inherit"
    );
  }

  function findScrollContainer() {
    const probe =
      document.querySelector('img[alt="Generated image"]') ||
      document.querySelector('img[alt*="media generated"]');
    if (!probe) return null;
    let el = probe.parentElement;
    while (el && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if (
        el.scrollHeight > el.clientHeight + 20 &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return document.documentElement;
  }

  async function scrollAndCount(container) {
    const urls = new Set();
    container.scrollTop = 0;
    await sleep(SCROLL_PAUSE);
    while (true) {
      document
        .querySelectorAll('img[alt="Generated image"]')
        .forEach((img) => {
          if (img.src) urls.add(img.src);
        });
      const before = container.scrollTop;
      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
      await sleep(SCROLL_PAUSE);
      if (container.scrollTop === before) break;
    }
    document
      .querySelectorAll('img[alt="Generated image"]')
      .forEach((img) => {
        if (img.src) urls.add(img.src);
      });
    return urls.size;
  }

  function findImageGroupDeleteButtons() {
    const results = [];
    document.querySelectorAll('[role="toolbar"]').forEach((toolbar) => {
      const buttons = toolbar.querySelectorAll("button");
      const hasReuse = [...buttons].some((b) =>
        b.textContent.includes("Reuse")
      );
      if (!hasReuse) return;
      const deleteBtn = [...buttons].find((b) =>
        b.textContent.includes("Delete")
      );
      if (deleteBtn) results.push(deleteBtn);
    });
    return results;
  }

  function findAllDeleteButtons() {
    const results = [];
    document.querySelectorAll('[role="toolbar"]').forEach((toolbar) => {
      const deleteBtn = [...toolbar.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Delete")
      );
      if (deleteBtn) results.push(deleteBtn);
    });
    return results;
  }

  async function confirmDelete(btn) {
    btn.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(300);
    btn.click();
    await sleep(DIALOG_WAIT);
    const allButtons = document.querySelectorAll("button");
    let confirmBtn = null;
    for (const b of allButtons) {
      const text = b.textContent.trim();
      if (
        text === "Delete" &&
        !b.closest('[role="toolbar"]')
      ) {
        confirmBtn = b;
        break;
      }
    }
    if (!confirmBtn) {
      log("⚠ Could not find confirmation dialog. Skipping.");
      document.querySelectorAll("button").forEach((b) => {
        if (b.textContent.trim() === "Cancel") b.click();
      });
      await sleep(500);
      return false;
    }
    confirmBtn.click();
    await sleep(DELETE_PAUSE);
    return true;
  }

  log("═══════════════════════════════════════════");
  log("  Flow Image Counter & Deleter");
  log("═══════════════════════════════════════════");

  log("");
  log("▶ PHASE 1: Counting all images…");
  const container = findScrollContainer();
  if (!container) {
    log("❌ No generated images found. Are you on a Flow project page?");
    return;
  }
  const initialCount = await scrollAndCount(container);
  log(`✅ Initial count: ${initialCount} unique image(s)`);
  if (initialCount === 0) {
    log("Nothing to delete. Done.");
    return;
  }

  log("");
  log("▶ PHASE 2: Deleting all image groups (top → bottom)…");
  container.scrollTop = 0;
  await sleep(SCROLL_PAUSE);
  let deletionRound = 0;

  while (true) {
    let deleteBtns = findImageGroupDeleteButtons();
    if (deleteBtns.length === 0) {
      deleteBtns = findAllDeleteButtons();
    }
    if (deleteBtns.length === 0) {
      const before = container.scrollTop;
      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
      await sleep(SCROLL_PAUSE);
      if (container.scrollTop === before) {
        log("No more delete buttons found.");
        break;
      }
      deleteBtns = findImageGroupDeleteButtons();
      if (deleteBtns.length === 0) {
        deleteBtns = findAllDeleteButtons();
      }
      if (deleteBtns.length === 0) continue;
    }
    const target = deleteBtns[0];
    deletionRound++;
    log(`  🗑 Deletion #${deletionRound}…`);
    const ok = await confirmDelete(target);
    if (ok) {
      log(`    ✓ Confirmed.`);
    } else {
      log(`    ✗ Failed — moving on.`);
    }
    container.scrollTop = 0;
    await sleep(SCROLL_PAUSE);
  }

  log(`✅ Completed ${deletionRound} deletion(s).`);

  log("");
  log("▶ PHASE 3: Re-counting images…");
  await sleep(1000);
  const containerAfter = findScrollContainer();
  if (!containerAfter) {
    log("✅ Final count: 0 images (no generated images remain)");
  } else {
    const finalCount = await scrollAndCount(containerAfter);
    log(`✅ Final count: ${finalCount} unique image(s)`);
  }

  log("");
  log("═══════════════════════════════════════════");
  log(`  Summary`);
  log(`  Before:     ${initialCount} image(s)`);
  log(`  Deletions:  ${deletionRound} batch(es)`);
  log(`  After:      ${containerAfter ? "re-counted above" : "0"}`);
  log("═══════════════════════════════════════════");
})();
```

---

## 3. Flow DOM Structure (Observed)

Understanding the DOM is critical for this feature since it manipulates UI elements directly.

**Image batch group** — each generation prompt produces a container with this structure:

```
generic (group container)
 ├── button > link > image[alt="Generated image"]   ← variant 1
 ├── button > link > image[alt="Generated image"]   ← variant 2
 ├── button > link > image[alt="Generated image"]   ← variant 3
 ├── button > link > image[alt="Generated image"]   ← variant 4
 ├── toolbar[role="toolbar"]                        ← IMAGE-GROUP toolbar
 │    ├── button  → icon "download"  + label "Download"
 │    ├── button  → icon "undo"      + label "Reuse Prompt"
 │    └── button  → icon "delete"    + label "Delete"
 ├── generic  → prompt text (e.g. "a red car on a mountain road")
 ├── generic  → "Created Apr 14, 2026"
 └── generic  → "🍌 Nano Banana 2" + aspect ratio
```

**Collection toolbar** (when images are grouped into a collection) has only 2 buttons — Download and Delete (no "Reuse Prompt"). This is how the script distinguishes the two toolbar types.

**Confirmation dialog** — when any Delete button is clicked, Flow shows:

```
dialog
 ├── heading  → "Delete N items?"
 ├── generic  → "Do you want to delete: N image(s)"
 │    └── generic → "warning" (icon)
 ├── button   → "Cancel"
 └── button   → "Delete"        ← NOT inside a [role="toolbar"]
```

The dialog's "Delete" button is identified by: `textContent.trim() === "Delete"` AND `!button.closest('[role="toolbar"]')`.

---

## 4. Changes to File Structure

Building on the download wizard spec, these are the additional/modified files:

```
flow-bulk-downloader/
├── ref/
│   ├── [ref scripts]
├── icons/                            ← (unchanged from download spec)
├── manifest.json                     ← MODIFY (no new permissions needed)
├── background.js                     ← MODIFY — add delete message relay
├── content-script.js                 ← MODIFY — add delete phase handlers
├── sidepanel.html                    ← MODIFY — add tab UI + delete wizard steps
├── sidepanel.js                      ← MODIFY — add delete wizard logic
├── sidepanel.css                     ← MODIFY — add delete-specific styles
└── README.md                         ← MODIFY — document delete feature
```

No new permissions are required beyond the download spec. The delete operation works entirely through DOM manipulation in the content script (clicking buttons, confirming dialogs) — it does not need any additional Chrome APIs.

---

## 5. Detailed Changes

### 5.1 `manifest.json` — No Additional Changes

The permissions from the download spec (`activeTab`, `scripting`, `downloads`, `sidePanel`, `tabs`) and host permissions (`https://*.google.com/*`, `https://*.googleusercontent.com/*`) are sufficient. The delete feature operates purely through injected content script DOM interactions — no new APIs needed.

### 5.2 `background.js` — MODIFY

Add message relay support for the delete workflow. The background already relays messages between the side panel and content script (from the download spec). The following new message types are added to the relay:

**New messages to relay (SidePanel → ContentScript):**

- `DELETE_SCAN` — triggers Phase 1 (scroll & count).
- `DELETE_START` — triggers Phase 2 (batch deletion loop).
- `DELETE_CANCEL` — aborts the deletion loop.

**New messages to relay (ContentScript → SidePanel):**

- `DELETE_SCAN_PROGRESS` — live image count during scanning.
- `DELETE_SCAN_RESULT` — final count after Phase 1.
- `DELETE_PROGRESS` — per-batch progress during Phase 2 (batch number, success/fail, images remaining).
- `DELETE_BATCH_COMPLETE` — one batch deletion finished.
- `DELETE_VERIFY_PROGRESS` — live count during Phase 3 re-count.
- `DELETE_COMPLETE` — all three phases finished, with summary.
- `DELETE_CANCELLED` — abort acknowledged.
- `DELETE_ERROR` — unrecoverable error during deletion.

The background performs no logic of its own for delete — it is a pure message relay. All deletion logic lives in the content script.

### 5.3 `content-script.js` — MODIFY

Add the following functions and message handlers, ported from the reference delete script.

**Functions ported from the reference script (same logic):**

- `scrollAndCount(container)` — scrolls top-to-bottom collecting unique `img[alt="Generated image"]` src URLs, returns count. Identical to the reference script's `scrollAndCount`. Sends `DELETE_SCAN_PROGRESS` messages with the running count during scrolling.

- `findImageGroupDeleteButtons()` — queries all `[role="toolbar"]` elements, filters for those where at least one child button's `textContent` includes `"Reuse"` (indicating an image-group toolbar, not a collection toolbar), then finds the button whose `textContent` includes `"Delete"`. Returns an array of matching delete buttons.

- `findAllDeleteButtons()` — queries all `[role="toolbar"]` elements and finds any button whose `textContent` includes `"Delete"`. Returns an array. Used as a fallback when no image-group delete buttons remain (to catch collection-level toolbars).

- `confirmDelete(btn)` — the core single-batch deletion routine:
  1. Scrolls the button into view (`scrollIntoView({ behavior: "instant", block: "center" })`).
  2. Waits 300ms for layout.
  3. Clicks the delete button.
  4. Waits `DIALOG_WAIT` (800ms) for the confirmation dialog to appear.
  5. Searches all `<button>` elements for one where `textContent.trim() === "Delete"` AND `!button.closest('[role="toolbar"]')` — this identifies the dialog's confirm button (not the toolbar's delete button).
  6. If not found, clicks any "Cancel" button to dismiss a stale dialog, returns `false`.
  7. Clicks the confirm button.
  8. Waits `DELETE_PAUSE` (1500ms) for the DOM to update after deletion.
  9. Returns `true`.

- `findScrollContainer()` — shared with the download feature (already in the content script from the download spec). The delete version also checks for `img[alt*="media generated"]` as a fallback probe selector.

**Configuration constants:**

```js
const DELETE_PAUSE = 1500;   // ms after confirming deletion for DOM to settle
const DIALOG_WAIT = 800;     // ms for confirmation dialog to appear
// SCROLL_PAUSE and SCROLL_STEP already defined from download feature
```

**New message handlers (`chrome.runtime.onMessage`):**

1. **`{ type: "DELETE_SCAN" }`** — Phase 1: Count

   - Call `findScrollContainer()`. If null, respond with `{ type: "DELETE_SCAN_RESULT", count: 0, error: "No generated images found" }`.
   - Call `scrollAndCount(container)`, sending `{ type: "DELETE_SCAN_PROGRESS", found: currentCount }` periodically during scrolling.
   - On completion, send `{ type: "DELETE_SCAN_RESULT", count: totalCount }`.

2. **`{ type: "DELETE_START" }`** — Phase 2: Delete loop + Phase 3: Verify

   - Set `deleteAborted = false`.
   - Scroll to top of container.
   - Enter the deletion loop (mirroring the reference script's Phase 2):
     - Query `findImageGroupDeleteButtons()`. If empty, fall back to `findAllDeleteButtons()`.
     - If still empty, scroll down by `SCROLL_STEP` and re-query. If at the bottom with no buttons, break.
     - Take the first (topmost) button.
     - Increment `deletionRound`.
     - Send `{ type: "DELETE_PROGRESS", round: deletionRound, status: "deleting" }`.
     - Call `confirmDelete(btn)`.
     - Send `{ type: "DELETE_BATCH_COMPLETE", round: deletionRound, success: true/false }`.
     - Check `deleteAborted` — if true, send `{ type: "DELETE_CANCELLED", roundsCompleted: deletionRound }` and return.
     - Scroll back to top, continue loop.
   - After the loop, enter Phase 3: verification.
   - Wait 1000ms for DOM to settle.
   - Call `findScrollContainer()` again. If null, final count = 0. Otherwise call `scrollAndCount()`, sending `{ type: "DELETE_VERIFY_PROGRESS", found: currentCount }` periodically.
   - Send `{ type: "DELETE_COMPLETE", initialCount, deletionRounds: deletionRound, finalCount }`.

3. **`{ type: "DELETE_CANCEL" }`** — Set `deleteAborted = true`. The loop checks this flag before each batch.

**State management:**

- Module-level `deleteAborted` boolean, reset to `false` on each `DELETE_START`.
- The `initialCount` from the scan phase is stored in module scope so Phase 2/3 can include it in the summary.

### 5.4 `sidepanel.html` — MODIFY

The side panel gets a **tab bar** at the top with two tabs: "Download" and "Delete". Each tab shows its own wizard. The HTML structure becomes:

```html
<div id="app">
  <!-- Tab bar -->
  <div id="tab-bar">
    <button id="tab-download" class="tab active" data-tab="download">
      📥 Download
    </button>
    <button id="tab-delete" class="tab" data-tab="delete">
      🗑️ Delete All
    </button>
  </div>

  <!-- ═══════════════════════════════════════ -->
  <!-- DOWNLOAD TAB (from download spec)      -->
  <!-- ═══════════════════════════════════════ -->
  <div id="panel-download" class="panel active">
    <!-- ... Steps 1–4 from the download spec, unchanged ... -->
  </div>

  <!-- ═══════════════════════════════════════ -->
  <!-- DELETE TAB                              -->
  <!-- ═══════════════════════════════════════ -->
  <div id="panel-delete" class="panel hidden">

    <!-- Step 1: Scan / Count -->
    <div id="del-step-scan" class="step active">
      <h2>Delete All Images</h2>
      <p class="warning-text">
        This will permanently delete <strong>every generated image</strong>
        in this Flow project. This action cannot be undone.
      </p>
      <button id="del-btn-scan" class="danger">
        Scan & Count Images
      </button>
      <div id="del-scan-status" class="status hidden">
        <span class="spinner"></span>
        <span id="del-scan-text">Scanning…</span>
      </div>
    </div>

    <!-- Step 2: Confirm deletion -->
    <div id="del-step-confirm" class="step hidden">
      <h2>⚠️ Confirm Deletion</h2>
      <div class="confirm-box">
        <p id="del-confirm-count"></p>
        <!-- e.g., "Found 42 images across multiple batches" -->
        <p class="warning-text">
          All images will be permanently deleted batch by batch.
          This cannot be undone.
        </p>
      </div>
      <label for="del-confirm-input">
        Type <strong>DELETE</strong> to confirm:
      </label>
      <input type="text" id="del-confirm-input" placeholder="DELETE" />
      <button id="del-btn-start" class="danger" disabled>
        Delete All Images
      </button>
      <button id="del-btn-back" class="secondary">Cancel</button>
    </div>

    <!-- Step 3: Deleting (progress) -->
    <div id="del-step-progress" class="step hidden">
      <h2>Deleting…</h2>
      <div class="progress-bar-container">
        <div id="del-progress-bar" class="progress-bar danger-bar"></div>
      </div>
      <p id="del-progress-text">Batch 0 deleted</p>
      <p id="del-progress-detail"></p>
      <!-- e.g., "3 succeeded, 0 failed" -->
      <div id="del-verify-status" class="hidden">
        <span class="spinner"></span>
        <span id="del-verify-text">Verifying…</span>
      </div>
      <button id="del-btn-cancel" class="secondary">
        Stop After Current Batch
      </button>
    </div>

    <!-- Step 4: Complete -->
    <div id="del-step-done" class="step hidden">
      <h2>Deletion Complete</h2>
      <div id="del-summary">
        <p id="del-summary-before"></p>
        <!-- "Before: 42 images" -->
        <p id="del-summary-batches"></p>
        <!-- "Batches deleted: 11" -->
        <p id="del-summary-after"></p>
        <!-- "Remaining: 0 images ✅" or "Remaining: 3 images ⚠️" -->
      </div>
      <button id="del-btn-reset" class="secondary">Done</button>
    </div>

  </div>

  <!-- Error banner (shared, from download spec) -->
  <div id="error-banner" class="hidden">
    <p id="error-text"></p>
    <button id="btn-dismiss-error">Dismiss</button>
  </div>
</div>
```

### 5.5 `sidepanel.js` — MODIFY

Add the delete wizard logic alongside the existing download wizard logic.

**Tab switching:**

- `#tab-download` and `#tab-delete` buttons toggle visibility of `#panel-download` and `#panel-delete` respectively.
- Switching tabs does NOT cancel an in-progress operation in the other tab — the user can switch back to check progress.
- Tab button gets an `active` class for visual styling.

**Delete wizard step logic:**

1. **Step 1 — Scan**: User clicks "Scan & Count Images". Sends `{ type: "DELETE_SCAN" }` to background. Shows spinner with live count ("Found 17 images so far…") as `DELETE_SCAN_PROGRESS` messages arrive. When `DELETE_SCAN_RESULT` arrives:
   - If `count === 0`: show error banner "No generated images found in this project."
   - If `count > 0`: transition to Step 2, populating the count text.

2. **Step 2 — Confirm**: Shows the count (e.g., "Found 42 generated images across this project"). Requires the user to type "DELETE" (case-sensitive) into a text input to enable the "Delete All Images" button. This is a safety gate to prevent accidental mass deletion. The button remains `disabled` until the input value exactly matches `"DELETE"`. An `input` event listener on `#del-confirm-input` toggles the `disabled` attribute. Clicking "Cancel" returns to Step 1. Clicking "Delete All Images" sends `{ type: "DELETE_START" }` and transitions to Step 3.

3. **Step 3 — Progress**: Listens for `DELETE_PROGRESS` and `DELETE_BATCH_COMPLETE` messages. Updates:
   - Progress bar width: there is no predefined total batch count (we only know image count, not batch count), so the bar cannot show a precise percentage. Instead, show a **pulsing/indeterminate progress bar** during the deletion phase, and switch to a determinate bar during the Phase 3 verification.
   - Text: "Batch 3 deleted… (2 succeeded, 1 failed)"
   - The "Stop After Current Batch" button sends `{ type: "DELETE_CANCEL" }`. This does NOT interrupt a batch mid-deletion — it lets the current `confirmDelete()` finish, then stops the loop.
   - When `DELETE_COMPLETE` arrives, transition to Step 4.
   - When `DELETE_CANCELLED` arrives, also transition to Step 4 (with partial summary).

4. **Step 4 — Done**: Shows a three-line summary mirroring the reference script's output:
   - "Before: 42 images"
   - "Batches deleted: 11"
   - "Remaining: 0 images ✅" or "Remaining: 3 images ⚠️" (if verification found leftovers)
   - A "Done" button resets back to Step 1.

**Error handling:**

- If the content script sends `DELETE_ERROR`, show the error banner with the message.
- If the tab navigates away mid-deletion, the background detects it (via `tabs.onUpdated`) and sends `{ type: "DELETE_ABORTED", reason: "Page navigated away" }` to the side panel — show error banner.

### 5.6 `sidepanel.css` — MODIFY

Add styles for the delete wizard:

- **Tab bar**: horizontal flex container, tabs as pill-shaped buttons. Active tab: solid white background with dark text. Inactive tab: transparent background with gray text. Bottom border separator.
- **Warning text (`.warning-text`)**: `color: #f87171` (red-400), used for irreversibility warnings.
- **Danger button (`.danger`)**: `background: #dc2626` (red-600), white text. Hover: `#b91c1c`. Disabled state: `opacity: 0.4; cursor: not-allowed`.
- **Confirm box (`.confirm-box`)**: border `1px solid #f87171`, `border-radius: 8px`, `padding: 12px`, background `rgba(248, 113, 113, 0.08)`. Visually signals danger.
- **Confirm input**: text input styled to match the dark theme. When the value matches `"DELETE"`, the border turns red to reinforce the danger.
- **Danger progress bar (`.danger-bar`)**: `background: #dc2626` instead of blue. Pulsing animation for indeterminate state (`@keyframes pulse { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }`).
- **Summary section (`#del-summary`)**: each line as a row, with counts highlighted. Green `#4ade80` for "0 remaining", amber `#fbbf24` for non-zero remaining.

### 5.7 `background.js` — MODIFY (Additional Detail)

When relaying delete messages, the background needs one piece of added logic beyond pure relay:

- **Tab navigation guard**: The background already monitors `chrome.tabs.onUpdated` for Flow page detection (download spec). Extend this handler: if a deletion is in-progress (track a `deletionActiveForTab` map) and the tab URL changes away from the Flow project pattern, send `{ type: "DELETE_ABORTED", reason: "Page navigated away" }` to the side panel.
- **State tracking**: Maintain a simple `Map<tabId, "idle" | "scanning" | "deleting">` in the background. Set to `"scanning"` on `DELETE_SCAN`, `"deleting"` on `DELETE_START`, back to `"idle"` on `DELETE_COMPLETE`, `DELETE_CANCELLED`, or `DELETE_ERROR`. Used only for the navigation guard check.

---

## 6. Message Protocol (Delete-Specific)

All messages use `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with a `type` field.

| Direction | Type | Payload | Description |
|---|---|---|---|
| SidePanel → Background | `DELETE_SCAN` | `{ tabId }` | User clicked "Scan & Count Images" |
| Background → ContentScript | `DELETE_SCAN` | — | Forwarded |
| ContentScript → Background | `DELETE_SCAN_PROGRESS` | `{ found: number }` | Live count during Phase 1 scrolling |
| Background → SidePanel | `DELETE_SCAN_PROGRESS` | `{ found: number }` | Relayed |
| ContentScript → Background | `DELETE_SCAN_RESULT` | `{ count: number, error?: string }` | Phase 1 complete |
| Background → SidePanel | `DELETE_SCAN_RESULT` | `{ count: number, error?: string }` | Relayed |
| SidePanel → Background | `DELETE_START` | `{ tabId }` | User typed DELETE and confirmed |
| Background → ContentScript | `DELETE_START` | — | Forwarded |
| ContentScript → Background | `DELETE_PROGRESS` | `{ round: number, status: "deleting" }` | About to delete batch N |
| Background → SidePanel | `DELETE_PROGRESS` | `{ round: number, status: "deleting" }` | Relayed for UI |
| ContentScript → Background | `DELETE_BATCH_COMPLETE` | `{ round: number, success: boolean }` | One batch finished |
| Background → SidePanel | `DELETE_BATCH_COMPLETE` | `{ round: number, success: boolean }` | Relayed |
| ContentScript → Background | `DELETE_VERIFY_PROGRESS` | `{ found: number }` | Live count during Phase 3 |
| Background → SidePanel | `DELETE_VERIFY_PROGRESS` | `{ found: number }` | Relayed |
| ContentScript → Background | `DELETE_COMPLETE` | `{ initialCount, deletionRounds, finalCount }` | All 3 phases done |
| Background → SidePanel | `DELETE_COMPLETE` | `{ initialCount, deletionRounds, finalCount }` | Relayed |
| SidePanel → Background | `DELETE_CANCEL` | — | User clicked "Stop After Current Batch" |
| Background → ContentScript | `DELETE_CANCEL` | — | Forwarded |
| ContentScript → Background | `DELETE_CANCELLED` | `{ roundsCompleted: number }` | Stopped after current batch |
| Background → SidePanel | `DELETE_CANCELLED` | `{ roundsCompleted: number }` | Relayed |
| Background → SidePanel | `DELETE_ABORTED` | `{ reason: string }` | Tab navigated away mid-delete |
| ContentScript → Background | `DELETE_ERROR` | `{ message: string }` | Unrecoverable error |
| Background → SidePanel | `DELETE_ERROR` | `{ message: string }` | Relayed |

---

## 7. Key Implementation Notes

### 7.1 Batch Count is Unknown Up Front

The scan phase (Phase 1) counts individual **images**, not **batches**. A batch might contain 1–4 images depending on the generation settings. The delete phase discovers batches dynamically by querying the DOM for delete buttons after each deletion. This means the progress bar cannot show "batch 3 of 11" — it only knows "batch 3 completed." The UI should use an indeterminate (pulsing) progress bar during deletion, and show a counter of completed batches rather than a percentage.

### 7.2 Deletion Order: Image Groups First, Then Collections

The reference script prioritizes image-group toolbars (those with a "Reuse Prompt" button — 3 buttons) over collection-level toolbars (those with only Download + Delete — 2 buttons). This ensures individual batches are deleted before their parent collection containers. The content script must follow this same priority:

1. Query `findImageGroupDeleteButtons()` first.
2. Only if that returns empty, fall back to `findAllDeleteButtons()`.

### 7.3 DOM Mutation After Each Deletion

After each batch deletion, the Flow DOM reorganizes — elements are removed, scroll positions change, and new elements may become visible. The reference script handles this by:

- Always scrolling back to `container.scrollTop = 0` after each deletion.
- Re-querying the DOM for delete buttons on every iteration (never caching stale references).
- Waiting `DELETE_PAUSE` (1500ms) after each confirmation for the DOM to settle.

These patterns must be preserved exactly in the content script.

### 7.4 Confirmation Dialog Detection

The Flow confirmation dialog is a `<dialog>` element containing:
- Heading: "Delete N items?"
- Body: "Do you want to delete: N image(s)" with a warning icon
- Two buttons: "Cancel" and "Delete"

The "Delete" button in the dialog is distinguished from the toolbar's "Delete" button by checking `!button.closest('[role="toolbar"]')`. This selector must not be changed — it's the only reliable way to differentiate the two.

### 7.5 Safety: "Type DELETE to Confirm" Gate

Since this operation is destructive and irreversible, the wizard requires the user to type the exact string `"DELETE"` (case-sensitive) into a text input before the "Delete All Images" button becomes enabled. This is similar to GitHub's "type the repo name to confirm deletion" pattern. The check is: `input.value === "DELETE"`. Any other value keeps the button disabled.

### 7.6 Cancellation Semantics

When the user clicks "Stop After Current Batch":
- The `deleteAborted` flag is set in the content script.
- The **currently executing** `confirmDelete()` call is allowed to finish completely (including the 1500ms wait). We do not abort mid-click or mid-dialog because that could leave the UI in a broken state (e.g., an open confirmation dialog).
- After the current batch finishes, the loop checks `deleteAborted`, exits, and proceeds to Phase 3 (verification count) so the user can see how many images remain.
- The side panel shows the partial results in Step 4.

### 7.7 Fallback Image Probe Selector

The delete reference script uses an additional fallback selector: `document.querySelector('img[alt*="media generated"]')` when searching for the scroll container probe element. This should be included in the shared `findScrollContainer()` function (updating the download version too) to handle edge cases where Flow uses a different alt text.

### 7.8 Re-entrancy Prevention

The side panel should disable the "Scan & Count Images" button while a scan or deletion is in progress. Similarly, switching to the Download tab and starting a download while a deletion is running (or vice versa) could cause conflicts since both features scroll the page. The side panel should show a warning and prevent starting a second operation: "A deletion is in progress. Please wait for it to complete before starting a download."

---

## 8. UX Flow Summary

1. User is on a Flow project page. Extension icon is active/colored (detected from download spec's background logic).
2. User clicks extension icon → side panel opens.
3. User clicks the **"🗑️ Delete All"** tab.
4. **Step 1 — Scan**: Panel shows a destructive-action warning and a red "Scan & Count Images" button. User clicks it. Spinner appears with live count ("Found 17 images so far…") as the content script scrolls through the page.
5. **Step 2 — Confirm**: Panel shows "Found 42 generated images" in a red-bordered danger box. Below it: a text input with the instruction "Type DELETE to confirm." The "Delete All Images" button is grayed out and disabled. The user types `DELETE` — the button turns red and becomes enabled. User clicks it.
6. **Step 3 — Deleting**: Panel shows a pulsing red progress bar. Text updates: "Batch 1 deleted… Batch 2 deleted…" with a success/failure count. A "Stop After Current Batch" button is available. After all batches, the text changes to "Verifying…" with a spinner as the content script re-scrolls to count remaining images.
7. **Step 4 — Done**: Panel shows a summary card: "Before: 42 images / Batches deleted: 11 / Remaining: 0 images ✅". A "Done" button resets to Step 1.