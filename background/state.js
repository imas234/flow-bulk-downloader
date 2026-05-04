// Per-tab UI state. The side panel is a pure renderer of this state, and all
// transitions happen by mutating here and broadcasting. Keeping the state
// shape centralized makes it easy to reason about what the panel sees.

import { isFlowUrl, projectIdFromUrl } from "./tabs.js";

/**
 * @typedef {"ready"|"scanning"|"confirm"|"downloading"|"done"} DownloadPhase
 * @typedef {"ready"|"scanning"|"confirm"|"deleting"|"verifying"|"done"} DeletePhase
 */

const tabState = new Map();

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
    deleteFailed: 0,
    deleteStuck: 0,
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
  return next;
}

export function dropState(tabId) {
  tabState.delete(tabId);
}

function broadcast(tabId, state) {
  // The panel may not be open; sendMessage rejects with no listener — swallow.
  chrome.runtime
    .sendMessage({ type: "STATE_UPDATE", tabId, state })
    .catch(() => {});
}
