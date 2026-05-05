// Download wizard: panel commands + content-script callbacks. The background
// acts as the state-machine owner; the content script only knows how to scan
// and fetch.

import { getState, setState } from "./state.js";
import { sendToTab } from "./tabs.js";

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

export const downloadHandlers = {
  // --- Panel → background ---

  async START_SCAN(message) {
    const tabId = message.tabId;
    if (!tabId) return { ok: false, error: "No tab" };
    const state = getState(tabId);
    if (!state.onFlowPage) return { ok: false, error: "Not a Flow page" };
    if (
      state.deletePhase === "scanning" ||
      state.deletePhase === "deleting" ||
      state.deletePhase === "verifying"
    ) {
      return { ok: false, error: "A deletion is in progress." };
    }
    setState(tabId, {
      phase: "scanning",
      scanFound: 0,
      urls: [],
      downloadProgress: { completed: 0, total: 0, failed: 0 },
      doneSummary: null,
      notice: null,
    });
    try {
      await sendToTab(tabId, { type: "SCAN" });
      return { ok: true };
    } catch (err) {
      setState(tabId, {
        phase: "ready",
        notice: { kind: "error", message: err.message || "Could not start scan." },
      });
      return { ok: false, error: err.message };
    }
  },

  async START_DOWNLOAD(message) {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false, error: "No active tab" };
    const state = getState(tabId);
    if (state.phase !== "confirm" || !state.urls.length) {
      return { ok: false, error: "Nothing to download" };
    }
    setState(tabId, {
      phase: "downloading",
      downloadProgress: { completed: 0, total: state.urls.length, failed: 0 },
      notice: null,
    });
    try {
      await sendToTab(tabId, {
        type: "DOWNLOAD",
        urls: state.urls,
        zipName: message.zipName,
      });
      return { ok: true };
    } catch (err) {
      setState(tabId, {
        phase: "confirm",
        notice: { kind: "error", message: err.message || "Could not start download." },
      });
      return { ok: false, error: err.message };
    }
  },

  async CANCEL() {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false };
    try {
      await chrome.tabs.sendMessage(tabId, { type: "CANCEL" });
    } catch {
      // Content script gone — reset locally so the UI doesn't get stuck.
      const state = getState(tabId);
      const phase = state.urls.length ? "confirm" : "ready";
      setState(tabId, {
        phase,
        downloadProgress: { completed: 0, total: 0, failed: 0 },
        notice: { kind: "info", message: "Download cancelled." },
      });
    }
    return { ok: true };
  },

  // --- Content script → background ---

  async SCAN_PROGRESS(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.phase === "scanning") {
      setState(tabId, { scanFound: message.found || 0 });
    }
    return { ok: true };
  },

  async SCAN_RESULT(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.phase !== "scanning") return { ok: true };
    const urls = message.urls || [];
    const projectId = message.projectId || state.projectId;
    if (message.error || urls.length === 0) {
      setState(tabId, {
        phase: "ready",
        scanFound: 0,
        urls: [],
        projectId,
        notice: {
          kind: "error",
          message: message.error || "No generated images found.",
        },
      });
    } else {
      setState(tabId, {
        phase: "confirm",
        scanFound: urls.length,
        urls,
        projectId,
        notice: null,
      });
    }
    return { ok: true };
  },

  async DOWNLOAD_PROGRESS(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.phase !== "downloading") return { ok: true };
    setState(tabId, {
      downloadProgress: {
        completed: message.completed || 0,
        total: message.total || state.downloadProgress.total,
        failed: message.failed || 0,
      },
    });
    return { ok: true };
  },

  async CANCELLED(_message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    const phase = state.urls.length ? "confirm" : "ready";
    setState(tabId, {
      phase,
      downloadProgress: { completed: 0, total: 0, failed: 0 },
      notice: { kind: "info", message: "Download cancelled." },
    });
    return { ok: true };
  },

  async ZIP_READY(message, sender) {
    // The content script already kicked the browser save via <a download>,
    // so the SW just transitions state and surfaces the summary.
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    setState(tabId, {
      phase: "done",
      doneSummary: {
        count: message.count || state.downloadProgress.total,
        sizeMB: message.sizeMB,
      },
      downloadProgress: { completed: 0, total: 0, failed: 0 },
    });
    return { ok: true };
  },
};
