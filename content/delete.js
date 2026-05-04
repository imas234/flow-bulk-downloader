// Delete flow: scan (count images + batches), loop top-to-bottom clicking
// each image-group's Delete button and confirming Flow's native dialog, then
// re-scan to verify. Cancellation is cooperative — the current batch always
// finishes so the UI never lands on a half-open confirmation dialog.
(() => {
  const FB = (window.__FlowBulk ||= {});
  const { SCROLL_PAUSE, SCROLL_STEP, DELETE_PAUSE, DIALOG_WAIT } = FB.constants;
  const { sleep } = FB;
  const {
    findScrollContainer,
    findImageGroupDeleteButtons,
    findAllDeleteButtons,
    findConfirmDeleteButton,
    clickAllCancelButtons,
    batchKey,
    batchLabel,
    batchExistsByKey,
  } = FB.dom;
  const { scrollAndCount } = FB.scan;

  const state = {
    inProgress: false,
    aborted: false,
  };

  async function confirmDelete(btn) {
    btn.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(300);
    btn.click();
    await sleep(DIALOG_WAIT);

    const confirmBtn = findConfirmDeleteButton();
    if (!confirmBtn) {
      clickAllCancelButtons();
      await sleep(500);
      return false;
    }

    confirmBtn.click();
    await sleep(DELETE_PAUSE);
    return true;
  }

  async function handleDeleteScan() {
    if (state.inProgress) return;
    state.inProgress = true;
    state.aborted = false;

    try {
      const container = findScrollContainer();
      if (!container) {
        chrome.runtime.sendMessage({
          type: "DELETE_SCAN_RESULT",
          images: 0,
          batches: 0,
          error: "Could not find a scrollable container on this page.",
        });
        return;
      }
      const { images, batches } = await scrollAndCount(
        container,
        ({ images, batches }) => {
          chrome.runtime.sendMessage({
            type: "DELETE_SCAN_PROGRESS",
            images,
            batches,
          });
        }
      );
      chrome.runtime.sendMessage({
        type: "DELETE_SCAN_RESULT",
        images,
        batches,
      });
    } catch (error) {
      chrome.runtime.sendMessage({
        type: "DELETE_SCAN_RESULT",
        images: 0,
        batches: 0,
        error: error.message || "Scan failed",
      });
    } finally {
      state.inProgress = false;
    }
  }

  // Collect candidate {btn, key} pairs from the current DOM, image-group
  // toolbars first, falling back to collection-level toolbars.
  function liveCandidates(stuckKeys) {
    let btns = findImageGroupDeleteButtons();
    if (btns.length === 0) btns = findAllDeleteButtons();
    const out = [];
    for (const btn of btns) {
      const tb = btn.closest('[role="toolbar"]');
      const key = batchKey(tb);
      // Drop batches we've already given up on. Without a key we have no
      // way to identify a stuck batch, so we let those through (worst case
      // we retry, but the same delete button click should still progress).
      if (key && stuckKeys.has(key)) continue;
      out.push({ btn, key });
    }
    return out;
  }

  // Find the next non-stuck delete target, scrolling forward as needed.
  // Returns null only when we've reached the bottom with nothing left.
  async function findNextLive(container, stuckKeys) {
    let live = liveCandidates(stuckKeys);
    if (live.length > 0) return live[0];

    while (true) {
      const before = container.scrollTop;
      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
      await sleep(SCROLL_PAUSE);
      if (container.scrollTop === before) return null;
      live = liveCandidates(stuckKeys);
      if (live.length > 0) return live[0];
    }
  }

  async function runDeleteLoop(container) {
    const stuckKeys = new Set();
    let rounds = 0;
    let failed = 0;
    let stuck = 0;

    while (!state.aborted) {
      const target = await findNextLive(container, stuckKeys);
      if (!target) break;

      const { btn, key } = target;
      const label = batchLabel(key);

      rounds++;
      chrome.runtime.sendMessage({
        type: "DELETE_PROGRESS",
        round: rounds,
        status: "deleting",
        currentKey: key,
        currentLabel: label,
      });

      const ok = await confirmDelete(btn);

      // Verify deletion: if the same content key still exists anywhere in
      // the DOM, Flow didn't actually remove the batch. Mark it stuck so
      // the next iteration skips past it instead of looping on btns[0].
      let actuallyDeleted = ok;
      let isStuck = false;
      if (ok) {
        if (key) {
          await sleep(300);
          if (batchExistsByKey(key)) {
            isStuck = true;
            actuallyDeleted = false;
            stuck++;
            stuckKeys.add(key);
          }
        }
      } else {
        // Dialog never appeared (or another failure). Skip this batch on
        // future iterations so we don't infinite-loop on it.
        failed++;
        if (key) stuckKeys.add(key);
      }

      chrome.runtime.sendMessage({
        type: "DELETE_BATCH_COMPLETE",
        round: rounds,
        success: actuallyDeleted,
        failed,
        stuck,
        currentKey: key,
        currentLabel: label,
        isStuck,
      });

      if (state.aborted) break;

      container.scrollTop = 0;
      await sleep(SCROLL_PAUSE);
    }

    return { rounds, failed, stuck };
  }

  async function handleDeleteStart(initialCount, initialBatches) {
    if (state.inProgress) return;
    state.inProgress = true;
    state.aborted = false;

    try {
      const container = findScrollContainer();
      if (!container) {
        chrome.runtime.sendMessage({
          type: "DELETE_ERROR",
          message: "Could not find a scrollable container on this page.",
        });
        return;
      }

      container.scrollTop = 0;
      await sleep(SCROLL_PAUSE);

      const { rounds, failed, stuck } = await runDeleteLoop(container);
      const cancelled = state.aborted;

      // Phase 3: verify. Not aborted by cancellation — the user wants the
      // final counts regardless.
      await sleep(1000);
      const verifyContainer = findScrollContainer();
      let finalCount = 0;
      let finalBatches = 0;
      if (verifyContainer) {
        const result = await scrollAndCount(
          verifyContainer,
          ({ images, batches }) => {
            chrome.runtime.sendMessage({
              type: "DELETE_VERIFY_PROGRESS",
              images,
              batches,
            });
          }
        );
        finalCount = result.images;
        finalBatches = result.batches;
      }

      chrome.runtime.sendMessage({
        type: "DELETE_COMPLETE",
        initialCount,
        initialBatches,
        rounds,
        failed,
        stuck,
        finalCount,
        finalBatches,
        cancelled,
      });
    } catch (error) {
      chrome.runtime.sendMessage({
        type: "DELETE_ERROR",
        message: error.message || "Delete failed",
      });
    } finally {
      state.inProgress = false;
      state.aborted = false;
    }
  }

  function abort() {
    state.aborted = true;
  }

  FB.del = { handleDeleteScan, handleDeleteStart, abort };
})();
