// Top-level render entry: delegates to the download or delete renderer based
// on state.mode. Every render pass records `lastState` for re-render heuristics.

import { showView, showTabs, setActiveTab, renderNotice } from "./views.js";
import { renderDownloadView } from "./render-download.js";
import { renderDeleteView } from "./render-delete.js";
import * as panelState from "./panel-state.js";

export function render(state) {
  panelState.trackRender(state);

  if (!state) {
    showTabs(false);
    showView("loading");
    renderNotice(null);
    return;
  }

  if (!state.onFlowPage) {
    showTabs(false);
    showView("empty");
    renderNotice(state.notice);
    return;
  }

  showTabs(true);
  const mode = state.mode === "delete" ? "delete" : "download";
  setActiveTab(mode);

  if (mode === "delete") {
    renderDeleteView(state);
  } else {
    renderDownloadView(state);
  }

  renderNotice(state.notice);
}
