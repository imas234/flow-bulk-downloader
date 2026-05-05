// Pure-DOM view machinery: showing/hiding views & panels, toggling tab state,
// rendering the shared notice banner. Knows nothing about wizard state.

import { app, panels, views, DELETE_VIEWS, els, buttons, tabBar } from "./dom.js";

export function showView(name) {
  app.dataset.phase = name;
  for (const [key, el] of Object.entries(views)) {
    if (el) el.classList.toggle("hidden", key !== name);
  }
  if (name === "loading" || name === "empty") {
    panels.download.classList.add("hidden");
    panels.delete.classList.add("hidden");
  } else if (DELETE_VIEWS.has(name)) {
    panels.download.classList.add("hidden");
    panels.delete.classList.remove("hidden");
  } else {
    panels.download.classList.remove("hidden");
    panels.delete.classList.add("hidden");
  }
}

export function showTabs(visible) {
  if (tabBar) tabBar.classList.toggle("hidden", !visible);
}

export function setActiveTab(mode) {
  app.dataset.mode = mode;
  buttons.tabDownload.classList.toggle("active", mode === "download");
  buttons.tabDownload.setAttribute(
    "aria-selected",
    mode === "download" ? "true" : "false"
  );
  buttons.tabDelete.classList.toggle("active", mode === "delete");
  buttons.tabDelete.setAttribute(
    "aria-selected",
    mode === "delete" ? "true" : "false"
  );
}

const ACTIVE_DOWNLOAD_PHASES = new Set(["scanning", "downloading"]);
const ACTIVE_DELETE_PHASES = new Set([
  "scanning",
  "deleting",
  "verifying",
]);

// Tab clicks during an in-flight op are almost always accidental — the
// active op stays running in the background, but the panel swaps to the
// other tab and the user can't see the progress, which reads as "state
// got reset." Lock the inactive tab while either side has work in flight.
export function lockTabsForActiveOp(state) {
  const downloadActive = ACTIVE_DOWNLOAD_PHASES.has(state.phase);
  const deleteActive = ACTIVE_DELETE_PHASES.has(state.deletePhase);
  const lock = downloadActive || deleteActive;
  setTabLocked(buttons.tabDownload, lock && deleteActive);
  setTabLocked(buttons.tabDelete, lock && downloadActive);
}

function setTabLocked(btn, locked) {
  btn.disabled = locked;
  btn.classList.toggle("locked", locked);
  if (locked) {
    btn.setAttribute(
      "title",
      "An operation is in progress on the other tab. Cancel or wait for it to finish."
    );
    btn.setAttribute("aria-disabled", "true");
  } else {
    btn.removeAttribute("title");
    btn.removeAttribute("aria-disabled");
  }
}

export function renderNotice(notice) {
  if (!notice) {
    els.notice.classList.add("hidden");
    els.notice.dataset.kind = "";
    els.noticeText.textContent = "";
    return;
  }
  els.notice.classList.remove("hidden");
  els.notice.dataset.kind = notice.kind || "info";
  els.noticeText.textContent = notice.message || "";
}
