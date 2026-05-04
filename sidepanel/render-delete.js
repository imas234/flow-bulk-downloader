// Delete-tab rendering. Branches on state.deletePhase; uses the scan-count
// helper from util.js so the same phrasing covers images-only,
// batches-only, and mixed cases uniformly.

import { els, buttons } from "./dom.js";
import { showView } from "./views.js";
import { describeScanCounts, pluralize } from "./util.js";
import * as panelState from "./panel-state.js";

export function renderDeleteView(state) {
  switch (state.deletePhase) {
    case "scanning": {
      const i = state.deleteScanFound;
      const b = state.deleteScanBatches;
      const bugged = !!state.deleteBugged;
      els.delScanText.textContent =
        i === 0 && b === 0
          ? "Scrolling and counting images…"
          : `Counted ${describeScanCounts(i, b, { bugged })} so far…${bugged ? " (bugged project — using batch-only fallback)" : ""}`;
      showView("del-scanning");
      break;
    }

    case "confirm": {
      const i = state.deleteInitialCount;
      const b = state.deleteInitialBatches;
      const bugged = !!state.deleteBugged;
      const summary = describeScanCounts(i, b, { bugged });
      els.delConfirmCount.textContent = bugged
        ? `${summary} will be deleted. Images failed to load — falling back to batch-only deletion.`
        : `${summary} will be deleted.`;
      // Preserve what the user is typing across re-renders. Only wipe the
      // input when we're entering confirm from a different phase.
      if (panelState.getLastDeletePhase() !== "confirm") {
        els.delConfirmInput.value = "";
        els.delConfirmInput.classList.remove("armed");
      }
      buttons.delStart.disabled = els.delConfirmInput.value !== "DELETE";
      showView("del-confirm");
      break;
    }

    case "deleting": {
      const { deleteRounds, deleteFailed, deleteInitialBatches } = state;
      // initialBatches is a lower bound (virtualized list), so grow it if the
      // actual rounds exceed the estimate. Denominator never lies about the
      // minimum remaining work.
      const total =
        deleteInitialBatches > 0
          ? Math.max(deleteInitialBatches, deleteRounds)
          : 0;
      const bar = els.delProgressBar;

      if (total > 0) {
        bar.classList.remove("indeterminate");
        const pct = Math.min(100, Math.round((deleteRounds / total) * 100));
        bar.style.width = `${pct}%`;
        els.delProgressText.textContent = `${deleteRounds} / ${total}`;
        els.delProgressLabel.textContent =
          deleteRounds === 1 ? "batch deleted" : "batches deleted";
      } else {
        bar.classList.add("indeterminate");
        bar.style.width = "";
        if (deleteRounds === 0) {
          els.delProgressText.textContent = "—";
          els.delProgressLabel.textContent = "preparing";
        } else {
          els.delProgressText.textContent = String(deleteRounds);
          els.delProgressLabel.textContent =
            deleteRounds === 1 ? "batch deleted" : "batches deleted";
        }
      }

      // Surface which batch is currently being processed. If Flow silently
      // doesn't delete a batch, this is the identifier we'll show as stuck.
      const label = state.deleteCurrentLabel;
      els.delCurrentBatch.textContent = label ? `now → ${label}` : "";

      const parts = [];
      if (state.deleteFailed > 0) parts.push(`${state.deleteFailed} failed`);
      if (state.deleteStuck > 0) parts.push(`${state.deleteStuck} stuck`);
      els.delProgressDetail.textContent = parts.join(" · ").toUpperCase();
      showView("del-deleting");
      break;
    }

    case "verifying": {
      const i = state.deleteVerifyFound;
      const b = state.deleteVerifyBatches;
      const bugged = !!state.deleteBugged;
      els.delVerifyText.textContent =
        i === 0 && b === 0
          ? "Re-counting remaining items…"
          : `${describeScanCounts(i, b, { bugged })} remaining…`;
      showView("del-verifying");
      break;
    }

    case "done": {
      const s = state.deleteSummary || {};
      const bugged = !!state.deleteBugged;
      els.delDoneTitle.textContent = s.cancelled
        ? "Deletion stopped"
        : "Deletion complete";
      els.delSummaryBefore.textContent = describeScanCounts(
        s.initialCount || 0,
        s.initialBatches || 0,
        { bugged }
      );
      els.delSummaryBatches.textContent = `${s.rounds || 0}${s.failed ? ` (${s.failed} failed)` : ""}`;

      const stuckCount = s.stuck || 0;
      els.delSummaryStuckRow.classList.toggle("hidden", stuckCount === 0);
      if (stuckCount > 0) {
        els.delSummaryStuck.textContent = `${stuckCount} ⚠`;
        els.delSummaryStuck.dataset.state = "warn";
      }

      const remainingImages = s.finalCount || 0;
      const remainingBatches = s.finalBatches || 0;
      if (remainingImages === 0 && remainingBatches === 0) {
        els.delSummaryAfter.textContent = "0 ✓";
        els.delSummaryAfter.dataset.state = "clean";
      } else {
        els.delSummaryAfter.textContent = `${describeScanCounts(remainingImages, remainingBatches, { bugged })} ⚠`;
        els.delSummaryAfter.dataset.state = "warn";
      }
      showView("del-done");
      break;
    }

    case "ready":
    default:
      showView("del-ready");
      break;
  }
}
