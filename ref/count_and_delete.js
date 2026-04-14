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

  // ─── Configuration ──────────────────────────────────────────────
  /** @type {number} ms to wait after each scroll step */
  const SCROLL_PAUSE = 600;
  /** @type {number} px to scroll each step */
  const SCROLL_STEP = 800;
  /** @type {number} ms to wait after clicking delete / confirm */
  const DELETE_PAUSE = 1500;
  /** @type {number} ms to wait for confirmation dialog to appear */
  const DIALOG_WAIT = 800;

  // ─── Utilities ──────────────────────────────────────────────────

  /** @param {number} ms */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Styled console logger.
   * @param {string} msg
   */
  function log(msg) {
    console.log(
      `%c[FlowDel]%c ${msg}`,
      "color:#f87171;font-weight:bold",
      "color:inherit"
    );
  }

  /**
   * Find the scrollable container (same logic as the download script).
   * @returns {HTMLElement|null}
   */
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

  /**
   * Scroll from top to bottom, collecting generated-image counts.
   * @param {HTMLElement} container
   * @returns {Promise<number>} total unique image count
   */
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

    // Final collection at the bottom
    document
      .querySelectorAll('img[alt="Generated image"]')
      .forEach((img) => {
        if (img.src) urls.add(img.src);
      });

    return urls.size;
  }

  /**
   * Find all delete buttons that belong to image-group toolbars
   * (not collection-level toolbars). Image-group toolbars have
   * 3 buttons (Download, Reuse Prompt, Delete), while collection
   * toolbars have only 2 (Download, Delete).
   *
   * We target buttons whose textContent includes "Delete" that
   * live inside a toolbar[role="toolbar"].
   *
   * @returns {HTMLButtonElement[]}
   */
  function findImageGroupDeleteButtons() {
    const results = [];
    document.querySelectorAll('[role="toolbar"]').forEach((toolbar) => {
      const buttons = toolbar.querySelectorAll("button");
      // Image-group toolbars have a "Reuse Prompt" button; collection toolbars don't
      const hasReuse = [...buttons].some((b) =>
        b.textContent.includes("Reuse")
      );
      if (!hasReuse) return; // skip collection toolbar

      const deleteBtn = [...buttons].find((b) =>
        b.textContent.includes("Delete")
      );
      if (deleteBtn) results.push(deleteBtn);
    });
    return results;
  }

  /**
   * Find ALL delete buttons (both collection and image-group).
   * @returns {HTMLButtonElement[]}
   */
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

  /**
   * Click a delete button, wait for the confirmation dialog,
   * then click "Delete" in the dialog.
   * @param {HTMLButtonElement} btn
   * @returns {Promise<boolean>} true if deletion was confirmed
   */
  async function confirmDelete(btn) {
    // Scroll the button into view
    btn.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(300);

    // Click the delete button
    btn.click();
    await sleep(DIALOG_WAIT);

    // Look for the confirmation dialog's "Delete" button
    // The dialog has two buttons: "Cancel" and "Delete"
    // The "Delete" confirm button is NOT inside a toolbar
    const allButtons = document.querySelectorAll("button");
    let confirmBtn = null;
    for (const b of allButtons) {
      const text = b.textContent.trim();
      // The confirm button says exactly "Delete" and is NOT in a toolbar
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
      // Try to dismiss any dialog
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

  // ─── Main flow ──────────────────────────────────────────────────

  log("═══════════════════════════════════════════");
  log("  Flow Image Counter & Deleter");
  log("═══════════════════════════════════════════");

  // ── Phase 1: Count ──────────────────────────────────────────────
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

  // ── Phase 2: Delete all image groups, top to bottom ─────────────
  log("");
  log("▶ PHASE 2: Deleting all image groups (top → bottom)…");

  // Scroll back to top
  container.scrollTop = 0;
  await sleep(SCROLL_PAUSE);

  let deletionRound = 0;

  while (true) {
    // Re-query for delete buttons (DOM changes after each deletion)
    // Start with image-group deletes; once those are gone, do collections
    let deleteBtns = findImageGroupDeleteButtons();

    if (deleteBtns.length === 0) {
      // No more image-group deletes — try collection-level deletes
      deleteBtns = findAllDeleteButtons();
    }

    if (deleteBtns.length === 0) {
      // Scroll down to see if there are more below the fold
      const before = container.scrollTop;
      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
      await sleep(SCROLL_PAUSE);

      if (container.scrollTop === before) {
        // Reached the bottom, no more delete buttons
        log("No more delete buttons found.");
        break;
      }

      // Re-check after scroll
      deleteBtns = findImageGroupDeleteButtons();
      if (deleteBtns.length === 0) {
        deleteBtns = findAllDeleteButtons();
      }
      if (deleteBtns.length === 0) continue;
    }

    // Always target the first (topmost) delete button
    const target = deleteBtns[0];
    deletionRound++;
    log(`  🗑 Deletion #${deletionRound}…`);

    const ok = await confirmDelete(target);
    if (ok) {
      log(`    ✓ Confirmed.`);
    } else {
      log(`    ✗ Failed — moving on.`);
    }

    // Scroll back to top to find next group
    container.scrollTop = 0;
    await sleep(SCROLL_PAUSE);
  }

  log(`✅ Completed ${deletionRound} deletion(s).`);

  // ── Phase 3: Re-count ───────────────────────────────────────────
  log("");
  log("▶ PHASE 3: Re-counting images…");

  // Brief pause for DOM to settle
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