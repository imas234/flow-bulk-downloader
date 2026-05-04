// Chrome event subscriptions: broadcast state updates from the background,
// tab activation / update, and window focus/visibility reconciliation.

import { render } from "./render.js";
import { showView, showTabs, renderNotice } from "./views.js";
import * as panelState from "./panel-state.js";

export async function refresh({ blank = true } = {}) {
  if (blank) {
    // Drop the tab binding so any in-flight STATE_UPDATE for the prior tab
    // is ignored — the listener only renders when activeTabId is known.
    panelState.setActiveTabId(null);
    showView("loading");
    showTabs(false);
    renderNotice(null);
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: "PANEL_READY" });
    if (!res?.ok) {
      render({
        onFlowPage: false,
        notice: { kind: "error", message: res?.error || "Could not initialize panel." },
      });
      return;
    }
    if (panelState.getActiveTabId() !== res.tabId) {
      panelState.setZipNameDirty(false);
    }
    panelState.setActiveTabId(res.tabId);
    render(res.state);
  } catch (err) {
    render({
      onFlowPage: false,
      notice: { kind: "error", message: err.message || "Could not initialize panel." },
    });
  }
}

export function installSubscriptions() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "STATE_UPDATE") return;
    const activeTabId = panelState.getActiveTabId();
    if (activeTabId === null) return;
    if (message.tabId !== activeTabId) return;
    render(message.state);
  });

  chrome.tabs.onActivated.addListener(() => {
    refresh();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== panelState.getActiveTabId()) return;
    if (typeof changeInfo.url === "string" || changeInfo.status === "complete") {
      refresh();
    }
  });

  // Reconcile state on focus/visibility without blanking — these fire when
  // the user returns to Chrome from another window/app and the existing
  // view should stay visible while we silently re-fetch.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh({ blank: false });
  });

  window.addEventListener("focus", () => {
    refresh({ blank: false });
  });
}
