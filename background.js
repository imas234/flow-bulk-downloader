const FLOW_URL_RE = /^https:\/\/labs\.google\/fx\/tools\/flow\/project\/[^/]+/;

const ICON_INACTIVE = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};

const ICON_ACTIVE = {
  16: "icons/icon-16-active.png",
  32: "icons/icon-32-active.png",
  48: "icons/icon-48-active.png",
  128: "icons/icon-128-active.png",
};

// Per-tab snapshot. Single source of truth for the UI.
// phase: ready | scanning | confirm | downloading | done
const tabState = new Map();

function isFlowUrl(url = "") {
  return FLOW_URL_RE.test(url);
}

function projectIdFromUrl(url = "") {
  return url.match(/project\/([^/?#]+)/)?.[1]?.slice(0, 8) || "flow";
}

function freshState(url = "") {
  return {
    url,
    onFlowPage: isFlowUrl(url),
    projectId: projectIdFromUrl(url),
    phase: "ready",
    scanFound: 0,
    urls: [],
    downloadProgress: { completed: 0, total: 0, failed: 0 },
    doneSummary: null,
    notice: null,
  };
}

function getState(tabId) {
  let state = tabState.get(tabId);
  if (!state) {
    state = freshState();
    tabState.set(tabId, state);
  }
  return state;
}

function setState(tabId, patch) {
  const next = { ...getState(tabId), ...patch };
  tabState.set(tabId, next);
  broadcast(tabId, next);
  return next;
}

function broadcast(tabId, state) {
  // Panel may not be open; sendMessage rejects with no listener — swallow it.
  chrome.runtime
    .sendMessage({ type: "STATE_UPDATE", tabId, state })
    .catch(() => {});
}

async function applyTabChrome(tabId, url) {
  const onFlowPage = isFlowUrl(url);
  try {
    await chrome.action.setIcon({ tabId, path: onFlowPage ? ICON_ACTIVE : ICON_INACTIVE });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#34a853" });
    await chrome.action.setBadgeText({ tabId, text: onFlowPage ? "✓" : "" });
    // Keep the panel available on every tab — the empty state inside the panel
    // handles the "not on a Flow project" case. Closing the panel via
    // `enabled: false` is disorienting when the user navigates back to the
    // projects list and we can't reliably re-open it without another gesture.
    await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
  } catch {
    // Tab may have been closed mid-call.
  }
}

// Send a message to the tab's content script, transparently injecting it if
// it isn't there. Flow uses client-side routing between the projects list
// and a project page, so when the user SPA-navigates from `/tools/flow` to
// `/project/<id>` the manifest-declared content script is NOT re-injected
// (no document load matched the pattern). Falling back to programmatic
// injection recovers from this. The content script guards against duplicate
// initialization, so injecting when one is already running is a no-op.
async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    const notFound =
      err?.message?.includes("Receiving end does not exist") ||
      err?.message?.includes("Could not establish connection");
    if (!notFound) throw err;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-script.js"],
  });
  return chrome.tabs.sendMessage(tabId, message);
}

async function syncTab(tabId, url) {
  await applyTabChrome(tabId, url);
  const previous = getState(tabId);
  const onFlowPage = isFlowUrl(url);

  if (!onFlowPage) {
    let notice = null;
    if (previous.phase === "scanning") {
      notice = { kind: "error", message: "Scan stopped — page navigated away from Flow." };
    } else if (previous.phase === "downloading") {
      notice = { kind: "error", message: "Download stopped — page navigated away from Flow." };
    }
    setState(tabId, { ...freshState(url), notice });
    return;
  }

  if (previous.url !== url) {
    // Navigated to a different (or first) Flow URL — reset the wizard.
    setState(tabId, freshState(url));
  } else {
    // Same URL; just refresh derived metadata, leave phase intact.
    setState(tabId, { url, onFlowPage: true, projectId: projectIdFromUrl(url) });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((t) => t.id).map((t) => syncTab(t.id, t.url || "")));
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (typeof changeInfo.url === "string") {
    await syncTab(tabId, changeInfo.url);
  } else if (changeInfo.status === "complete") {
    await syncTab(tabId, tab.url || "");
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncTab(tabId, tab.url || "");
  } catch {
    /* tab gone */
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const reply = await handleMessage(message, sender);
      sendResponse(reply);
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || "Unexpected error" });
    }
  })();
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "PANEL_READY": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return { ok: false, error: "No active tab" };
      await syncTab(activeTab.id, activeTab.url || "");
      return { ok: true, tabId: activeTab.id, state: getState(activeTab.id) };
    }

    case "START_SCAN": {
      const tabId = message.tabId;
      if (!tabId) return { ok: false, error: "No tab" };
      const state = getState(tabId);
      if (!state.onFlowPage) return { ok: false, error: "Not a Flow page" };
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
    }

    case "START_DOWNLOAD": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return { ok: false, error: "No active tab" };
      const tabId = activeTab.id;
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
    }

    case "CANCEL": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return { ok: false };
      try {
        await chrome.tabs.sendMessage(activeTab.id, { type: "CANCEL" });
      } catch {
        // Content script gone — reset locally so UI doesn't get stuck.
        const state = getState(activeTab.id);
        const phase = state.urls.length ? "confirm" : "ready";
        setState(activeTab.id, {
          phase,
          downloadProgress: { completed: 0, total: 0, failed: 0 },
          notice: { kind: "info", message: "Download cancelled." },
        });
      }
      return { ok: true };
    }

    case "RESET": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return { ok: false };
      const state = getState(activeTab.id);
      setState(activeTab.id, freshState(state.url));
      return { ok: true };
    }

    case "DISMISS_NOTICE": {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return { ok: false };
      setState(activeTab.id, { notice: null });
      return { ok: true };
    }

    // --- From content script ---

    case "SCAN_PROGRESS": {
      const tabId = sender.tab?.id;
      if (!tabId) return { ok: true };
      const state = getState(tabId);
      if (state.phase === "scanning") {
        setState(tabId, { scanFound: message.found || 0 });
      }
      return { ok: true };
    }

    case "SCAN_RESULT": {
      const tabId = sender.tab?.id;
      if (!tabId) return { ok: true };
      const state = getState(tabId);
      // Ignore stragglers if we no longer expect a result for this tab.
      if (state.phase !== "scanning") return { ok: true };
      const urls = message.urls || [];
      const projectId = message.projectId || state.projectId;
      if (message.error || urls.length === 0) {
        setState(tabId, {
          phase: "ready",
          scanFound: 0,
          urls: [],
          projectId,
          notice: { kind: "error", message: message.error || "No generated images found." },
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
    }

    case "DOWNLOAD_PROGRESS": {
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
    }

    case "CANCELLED": {
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
    }

    case "ZIP_READY": {
      const tabId = sender.tab?.id;
      try {
        const downloadId = await chrome.downloads.download({
          url: message.blobUrl,
          filename: message.zipName,
          saveAs: true,
        });
        if (tabId) {
          // Tell the content script (origin of the blob) to revoke it.
          chrome.tabs
            .sendMessage(tabId, { type: "REVOKE_BLOB", blobUrl: message.blobUrl })
            .catch(() => {});
          const state = getState(tabId);
          setState(tabId, {
            phase: "done",
            doneSummary: { count: state.downloadProgress.total, sizeMB: message.sizeMB },
            downloadProgress: { completed: 0, total: 0, failed: 0 },
          });
        }
        return { ok: true, downloadId };
      } catch (err) {
        if (tabId) {
          setState(tabId, {
            phase: "confirm",
            notice: { kind: "error", message: err.message || "Download failed." },
          });
        }
        return { ok: false, error: err.message };
      }
    }
  }
  return { ok: true };
}
