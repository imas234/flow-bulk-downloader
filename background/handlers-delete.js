// Delete wizard: panel commands + content-script callbacks.

import { getState, setState } from "./state.js";
import { sendToTab } from "./tabs.js";

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

const RESET_FIELDS = {
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
};

export const deleteHandlers = {
  // --- Panel → background ---

  async START_DELETE_SCAN(message) {
    const tabId = message.tabId;
    if (!tabId) return { ok: false, error: "No tab" };
    const state = getState(tabId);
    if (!state.onFlowPage) return { ok: false, error: "Not a Flow page" };
    if (state.phase === "scanning" || state.phase === "downloading") {
      return { ok: false, error: "A download operation is already running." };
    }
    setState(tabId, {
      deletePhase: "scanning",
      ...RESET_FIELDS,
      notice: null,
    });
    try {
      await sendToTab(tabId, { type: "DELETE_SCAN" });
      return { ok: true };
    } catch (err) {
      setState(tabId, {
        deletePhase: "ready",
        notice: { kind: "error", message: err.message || "Could not start scan." },
      });
      return { ok: false, error: err.message };
    }
  },

  async START_DELETE() {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false, error: "No active tab" };
    const state = getState(tabId);
    const nothingToDelete =
      state.deletePhase !== "confirm" ||
      (state.deleteInitialCount <= 0 && state.deleteInitialBatches <= 0);
    if (nothingToDelete) return { ok: false, error: "Nothing to delete" };

    setState(tabId, {
      deletePhase: "deleting",
      deleteRounds: 0,
      deleteSucceeded: 0,
      deleteFailed: 0,
      deleteStuck: 0,
      // Preserve deleteBugged from scan — the panel uses it to surface the
      // fallback-mode hint while deletion runs.
      deleteCurrentLabel: null,
      deleteVerifyFound: 0,
      deleteVerifyBatches: 0,
      notice: null,
    });
    try {
      await sendToTab(tabId, {
        type: "DELETE_START",
        initialCount: state.deleteInitialCount,
        initialBatches: state.deleteInitialBatches,
      });
      return { ok: true };
    } catch (err) {
      setState(tabId, {
        deletePhase: "confirm",
        notice: { kind: "error", message: err.message || "Could not start deletion." },
      });
      return { ok: false, error: err.message };
    }
  },

  async CANCEL_DELETE() {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false };
    try {
      await chrome.tabs.sendMessage(tabId, { type: "DELETE_CANCEL" });
    } catch {
      // Content script gone — leave the DOM as-is; user can retry.
    }
    return { ok: true };
  },

  async RESET_DELETE() {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false };
    setState(tabId, {
      deletePhase: "ready",
      ...RESET_FIELDS,
      notice: null,
    });
    return { ok: true };
  },

  // --- Content script → background ---

  async DELETE_SCAN_PROGRESS(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.deletePhase === "scanning") {
      setState(tabId, {
        deleteScanFound: message.images || 0,
        deleteScanBatches: message.batches || 0,
        deleteBugged: !!message.bugged,
      });
    }
    return { ok: true };
  },

  async DELETE_SCAN_RESULT(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.deletePhase !== "scanning") return { ok: true };
    const images = message.images || 0;
    const batches = message.batches || 0;
    const bugged = !!message.bugged;
    if (message.error || (images === 0 && batches === 0)) {
      setState(tabId, {
        deletePhase: "ready",
        deleteScanFound: 0,
        deleteScanBatches: 0,
        deleteInitialCount: 0,
        deleteInitialBatches: 0,
        deleteBugged: false,
        notice: {
          kind: "error",
          message: message.error || "No image batches found — nothing to delete.",
        },
      });
    } else {
      setState(tabId, {
        deletePhase: "confirm",
        deleteScanFound: images,
        deleteScanBatches: batches,
        deleteInitialCount: images,
        deleteInitialBatches: batches,
        deleteBugged: bugged,
        notice: null,
      });
    }
    return { ok: true };
  },

  async DELETE_PROGRESS(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.deletePhase !== "deleting") return { ok: true };
    setState(tabId, {
      deleteRounds: message.round || state.deleteRounds,
      deleteCurrentLabel: message.currentLabel || state.deleteCurrentLabel,
    });
    return { ok: true };
  },

  async DELETE_BATCH_COMPLETE(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.deletePhase !== "deleting") return { ok: true };
    // The content-script counters are authoritative — every message is a
    // full snapshot of {round, succeeded, failed, stuck}, so the SW just
    // mirrors them. This is what reconciles the panel after a SW wake-up:
    // even if the persisted state was stale, the next message replaces it
    // with the loop's current truth.
    setState(tabId, {
      deleteRounds: message.round || state.deleteRounds,
      deleteSucceeded:
        typeof message.succeeded === "number"
          ? message.succeeded
          : state.deleteSucceeded,
      deleteFailed:
        typeof message.failed === "number" ? message.failed : state.deleteFailed,
      deleteStuck:
        typeof message.stuck === "number" ? message.stuck : state.deleteStuck,
      deleteCurrentLabel: message.currentLabel || state.deleteCurrentLabel,
    });
    return { ok: true };
  },

  async DELETE_VERIFY_PROGRESS(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    const state = getState(tabId);
    if (state.deletePhase !== "deleting" && state.deletePhase !== "verifying") {
      return { ok: true };
    }
    setState(tabId, {
      deletePhase: "verifying",
      deleteVerifyFound: message.images || 0,
      deleteVerifyBatches: message.batches || 0,
      deleteBugged:
        typeof message.bugged === "boolean" ? message.bugged : state.deleteBugged,
    });
    return { ok: true };
  },

  async DELETE_COMPLETE(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    setState(tabId, {
      deletePhase: "done",
      deleteCurrentLabel: null,
      deleteSummary: {
        initialCount: message.initialCount || 0,
        initialBatches: message.initialBatches || 0,
        rounds: message.rounds || 0,
        succeeded: message.succeeded || 0,
        failed: message.failed || 0,
        stuck: message.stuck || 0,
        finalCount: message.finalCount || 0,
        finalBatches: message.finalBatches || 0,
        cancelled: !!message.cancelled,
      },
    });
    return { ok: true };
  },

  async DELETE_ERROR(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) return { ok: true };
    setState(tabId, {
      deletePhase: "ready",
      notice: { kind: "error", message: message.message || "Deletion failed." },
    });
    return { ok: true };
  },
};
