// Download-tab rendering. Every branch of state.phase has exactly one view.

import { els } from "./dom.js";
import { showView } from "./views.js";
import { defaultZipName } from "./util.js";
import * as panelState from "./panel-state.js";

export function renderDownloadView(state) {
  switch (state.phase) {
    case "scanning":
      els.scanText.textContent =
        state.scanFound > 0
          ? `Found ${state.scanFound} images so far…`
          : "Scrolling and collecting images…";
      showView("scanning");
      break;

    case "confirm":
      els.confirmCount.textContent = `Found ${state.scanFound} generated image${state.scanFound === 1 ? "" : "s"}.`;
      if (!panelState.isZipNameDirty() || !els.zipName.value.trim()) {
        els.zipName.value = defaultZipName(state.projectId);
      }
      showView("confirm");
      break;

    case "downloading": {
      const { completed, total, failed } = state.downloadProgress;
      const pct = total ? Math.round((completed / total) * 100) : 0;
      els.progressBar.style.width = `${pct}%`;
      els.progressText.textContent = `${completed} / ${total} images fetched`;
      if (failed > 0) {
        els.progressFailed.classList.remove("hidden");
        els.progressFailed.textContent = `${failed} failed`;
      } else {
        els.progressFailed.classList.add("hidden");
      }
      showView("downloading");
      break;
    }

    case "done": {
      const { count, sizeMB } = state.doneSummary || {};
      els.doneText.textContent = `Downloaded ${count || 0} image${count === 1 ? "" : "s"} (${sizeMB || "?"} MB).`;
      showView("done");
      break;
    }

    case "ready":
    default:
      showView("ready");
      break;
  }
}
