// The panel is a pure renderer of the background's per-tab state.
// All UI transitions come from STATE_UPDATE; click handlers only send commands.

const app = document.getElementById("app");

const views = {
  loading: document.getElementById("view-loading"),
  empty: document.getElementById("view-empty"),
  ready: document.getElementById("view-ready"),
  scanning: document.getElementById("view-scanning"),
  confirm: document.getElementById("view-confirm"),
  downloading: document.getElementById("view-downloading"),
  done: document.getElementById("view-done"),
};

const els = {
  scanText: document.getElementById("scan-text"),
  confirmCount: document.getElementById("confirm-count"),
  zipName: document.getElementById("zip-name"),
  progressBar: document.getElementById("progress-bar"),
  progressText: document.getElementById("progress-text"),
  progressFailed: document.getElementById("progress-failed"),
  doneText: document.getElementById("done-text"),
  notice: document.getElementById("notice"),
  noticeText: document.getElementById("notice-text"),
};

const buttons = {
  scan: document.getElementById("btn-scan"),
  download: document.getElementById("btn-download"),
  rescan: document.getElementById("btn-rescan"),
  cancel: document.getElementById("btn-cancel"),
  newProject: document.getElementById("btn-new"),
  dismissNotice: document.getElementById("btn-dismiss-notice"),
};

let activeTabId = null;
let zipNameDirty = false;

function dateStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function defaultZipName(projectId) {
  return `flow_${(projectId || "flow").slice(0, 8)}_${dateStamp()}.zip`;
}

function showView(name) {
  app.dataset.phase = name;
  for (const [key, el] of Object.entries(views)) {
    if (el) el.classList.toggle("hidden", key !== name);
  }
}

function renderNotice(notice) {
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

function render(state) {
  if (!state) {
    showView("loading");
    renderNotice(null);
    return;
  }

  if (!state.onFlowPage) {
    showView("empty");
    renderNotice(state.notice);
    return;
  }

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
      if (!zipNameDirty || !els.zipName.value.trim()) {
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

  renderNotice(state.notice);
}

async function refresh({ blank = true } = {}) {
  if (blank) {
    // Drop the tab binding so any in-flight STATE_UPDATE for the prior tab is
    // ignored — the listener only renders when activeTabId is known.
    activeTabId = null;
    showView("loading");
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
    if (activeTabId !== res.tabId) {
      // We landed on a different tab than expected — reset the dirty flag.
      zipNameDirty = false;
    }
    activeTabId = res.tabId;
    render(res.state);
  } catch (err) {
    render({
      onFlowPage: false,
      notice: { kind: "error", message: err.message || "Could not initialize panel." },
    });
  }
}

// --- Click handlers (commands only; UI updates arrive via STATE_UPDATE) ---

buttons.scan.addEventListener("click", async () => {
  if (!activeTabId) return;
  zipNameDirty = false;
  const res = await chrome.runtime.sendMessage({ type: "START_SCAN", tabId: activeTabId });
  if (!res?.ok && res?.error) {
    renderNotice({ kind: "error", message: res.error });
  }
});

buttons.download.addEventListener("click", async () => {
  const zipName = els.zipName.value.trim() || defaultZipName("flow");
  const res = await chrome.runtime.sendMessage({ type: "START_DOWNLOAD", zipName });
  if (!res?.ok && res?.error) {
    renderNotice({ kind: "error", message: res.error });
  }
});

buttons.rescan.addEventListener("click", async () => {
  if (!activeTabId) return;
  zipNameDirty = false;
  await chrome.runtime.sendMessage({ type: "START_SCAN", tabId: activeTabId });
});

buttons.cancel.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CANCEL" });
});

buttons.newProject.addEventListener("click", async () => {
  zipNameDirty = false;
  await chrome.runtime.sendMessage({ type: "RESET" });
});

buttons.dismissNotice.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "DISMISS_NOTICE" });
});

els.zipName.addEventListener("input", () => {
  zipNameDirty = true;
});

// --- Subscriptions ---

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "STATE_UPDATE") return;
  // Suppress broadcasts until refresh() resolves and we know which tab we're
  // bound to — otherwise a stale update for the prior tab can flash through.
  if (activeTabId === null) return;
  if (message.tabId !== activeTabId) return;
  render(message.state);
});

chrome.tabs.onActivated.addListener(() => {
  refresh();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== activeTabId) return;
  if (typeof changeInfo.url === "string" || changeInfo.status === "complete") {
    refresh();
  }
});

// Reconcile state on focus/visibility without blanking — these fire when the
// user returns to Chrome from another window/app and the existing view should
// stay visible while we silently re-fetch.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh({ blank: false });
});

window.addEventListener("focus", () => {
  refresh({ blank: false });
});

refresh();
