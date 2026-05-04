// Tab lifecycle + side-panel / icon chrome. Keeps the service worker aware of
// which tabs are on a Flow project so the action icon, badge, and wizard
// state stay in sync with SPA navigation.

import { freshState, getState, setState, dropState } from "./state.js";

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

// Must stay in sync with manifest.json's content_scripts.js list. Used when
// SPA navigation lands us on a Flow project page without triggering the
// manifest's declarative injection, forcing us to inject programmatically.
const CONTENT_SCRIPT_FILES = [
  "content/constants.js",
  "content/dom.js",
  "content/zip.js",
  "content/blob-to-dataurl.js",
  "content/scan.js",
  "content/download.js",
  "content/delete.js",
  "content/index.js",
];

export function isFlowUrl(url = "") {
  return FLOW_URL_RE.test(url);
}

export function projectIdFromUrl(url = "") {
  return url.match(/project\/([^/?#]+)/)?.[1]?.slice(0, 8) || "flow";
}

async function applyTabChrome(tabId, url) {
  const onFlowPage = isFlowUrl(url);
  try {
    await chrome.action.setIcon({
      tabId,
      path: onFlowPage ? ICON_ACTIVE : ICON_INACTIVE,
    });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#34a853" });
    await chrome.action.setBadgeText({ tabId, text: onFlowPage ? "✓" : "" });
    // Keep the panel available on every tab — the empty state inside the
    // panel handles the "not on a Flow project" case. Disabling the panel
    // is disorienting when the user flips between tabs.
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel.html",
      enabled: true,
    });
  } catch {
    // Tab closed mid-call, nothing to recover.
  }
}

export async function sendToTab(tabId, message) {
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
    files: CONTENT_SCRIPT_FILES,
  });
  return chrome.tabs.sendMessage(tabId, message);
}

function navigationAwayNotice(previous) {
  if (previous.phase === "scanning") {
    return { kind: "error", message: "Scan stopped — page navigated away from Flow." };
  }
  if (previous.phase === "downloading") {
    return { kind: "error", message: "Download stopped — page navigated away from Flow." };
  }
  if (previous.deletePhase === "scanning") {
    return { kind: "error", message: "Scan stopped — page navigated away from Flow." };
  }
  if (previous.deletePhase === "deleting" || previous.deletePhase === "verifying") {
    return { kind: "error", message: "Deletion stopped — page navigated away from Flow." };
  }
  return null;
}

export async function syncTab(tabId, url) {
  await applyTabChrome(tabId, url);
  const previous = getState(tabId);

  if (!isFlowUrl(url)) {
    setState(tabId, {
      ...freshState(url),
      notice: navigationAwayNotice(previous),
    });
    return;
  }

  if (previous.url !== url) {
    // Navigated to a different (or first) Flow URL — reset both wizards.
    setState(tabId, freshState(url));
  } else {
    // Same URL; keep any in-flight wizard state, refresh derived metadata.
    setState(tabId, {
      url,
      onFlowPage: true,
      projectId: projectIdFromUrl(url),
    });
  }
}

// Track loading state per tab to detect refreshes (same URL, loading -> complete)
const loadingTabs = new Set();

function isActiveOperation(state) {
  return (
    state.phase === "scanning" ||
    state.phase === "downloading" ||
    state.deletePhase === "scanning" ||
    state.deletePhase === "deleting" ||
    state.deletePhase === "verifying"
  );
}

function refreshStoppedNotice(previous) {
  if (previous.phase === "scanning" || previous.deletePhase === "scanning") {
    return { kind: "error", message: "Scan stopped — page was refreshed." };
  }
  if (previous.phase === "downloading") {
    return { kind: "error", message: "Download stopped — page was refreshed." };
  }
  if (previous.deletePhase === "deleting" || previous.deletePhase === "verifying") {
    return { kind: "error", message: "Deletion stopped — page was refreshed." };
  }
  return null;
}

export function installLifecycleListeners() {
  chrome.runtime.onInstalled.addListener(async () => {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.filter((t) => t.id).map((t) => syncTab(t.id, t.url || ""))
    );
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (typeof changeInfo.url === "string") {
      await syncTab(tabId, changeInfo.url);
    } else if (changeInfo.status === "loading") {
      loadingTabs.add(tabId);
    } else if (changeInfo.status === "complete") {
      const wasLoading = loadingTabs.has(tabId);
      loadingTabs.delete(tabId);

      const url = tab.url || "";
      const previous = getState(tabId);

      // Same URL + was loading = refresh. Reset active operations since
      // the content script (which does the actual work) was killed.
      if (wasLoading && url === previous.url && isActiveOperation(previous)) {
        setState(tabId, {
          ...freshState(url),
          notice: refreshStoppedNotice(previous),
        });
        return;
      }

      await syncTab(tabId, url);
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
    loadingTabs.delete(tabId);
    dropState(tabId);
  });

  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    await chrome.sidePanel.open({ tabId: tab.id });
  });
}
