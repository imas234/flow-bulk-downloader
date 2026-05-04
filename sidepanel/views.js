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
