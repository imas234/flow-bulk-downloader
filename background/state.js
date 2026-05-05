// Per-tab UI state. The side panel is a pure renderer of this state, and all
// transitions happen by mutating here and broadcasting. Keeping the state
// shape centralized makes it easy to reason about what the panel sees.
//
// MV3 service workers die after ~30s idle, so any in-memory map would lose
// in-flight delete/download state whenever the user backgrounds Chrome (e.g.
// switches macOS Spaces). The content script keeps running the actual loop
// in the page, but on SW wake-up we'd serve a freshState() to the panel and
// then ignore incoming DELETE_PROGRESS messages because the rehydrated state
// no longer says "deleting". chrome.storage.session — in-memory but
// SW-restart-survivable — gets us through that gap without persisting
// anything across browser restarts.

import { isFlowUrl, projectIdFromUrl } from "./tabs.js";

/**
 * @typedef {"ready"|"scanning"|"confirm"|"downloading"|"done"} DownloadPhase
 * @typedef {"ready"|"scanning"|"confirm"|"deleting"|"verifying"|"done"} DeletePhase
 */

const tabState = new Map();
const STORAGE_KEY = "flowBulk.tabState.v1";

export const hydrationPromise = (async () => {
  try {
    const obj = await chrome.storage.session.get(STORAGE_KEY);
    const stored = obj?.[STORAGE_KEY];
    if (stored && typeof stored === "object") {
      for (const [tabIdStr, state] of Object.entries(stored)) {
        const tabId = Number(tabIdStr);
        if (Number.isFinite(tabId) && state) tabState.set(tabId, state);
      }
    }
  } catch {
    // storage.session unavailable — fall through with an empty map.
  }
})();

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      const obj = {};
      for (const [tabId, state] of tabState) obj[tabId] = state;
      await chrome.storage.session.set({ [STORAGE_KEY]: obj });
    } catch {
      // Best-effort. If session storage is unavailable, in-memory state
      // is still authoritative for the lifetime of this SW instance.
    }
  }, 0);
}

export function freshState(url = "") {
  return {
    url,
    onFlowPage: isFlowUrl(url),
    projectId: projectIdFromUrl(url),

    mode: "download",

    // Download wizard
    phase: "ready",
    scanFound: 0,
    urls: [],
    downloadProgress: { completed: 0, total: 0, failed: 0 },
    doneSummary: null,

    // Delete wizard
    deletePhase: "ready",
    deleteScanFound: 0,
    deleteScanBatches: 0,
    deleteInitialCount: 0,
    deleteInitialBatches: 0,
    deleteRounds: 0,
    deleteSucceeded: 0,
    deleteFailed: 0,
    deleteStuck: 0,
    deleteBugged: false,
    deleteCurrentLabel: null,
    deleteVerifyFound: 0,
    deleteVerifyBatches: 0,
    deleteSummary: null,

    notice: null,
  };
}

export function getState(tabId) {
  let state = tabState.get(tabId);
  if (!state) {
    state = freshState();
    tabState.set(tabId, state);
  }
  return state;
}

export function setState(tabId, patch) {
  const next = { ...getState(tabId), ...patch };
  tabState.set(tabId, next);
  broadcast(tabId, next);
  schedulePersist();
  return next;
}

export function dropState(tabId) {
  tabState.delete(tabId);
  schedulePersist();
}

function broadcast(tabId, state) {
  // The panel may not be open; sendMessage rejects with no listener — swallow.
  chrome.runtime
    .sendMessage({ type: "STATE_UPDATE", tabId, state })
    .catch(() => {});
}
