// Panel-level commands that don't belong to a specific wizard: initial
// handshake, tab switching, reset, and dismissing the shared notice banner.

import { getState, setState, freshState } from "./state.js";
import { syncTab } from "./tabs.js";

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

export const panelHandlers = {
  async PANEL_READY() {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false, error: "No active tab" };
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await syncTab(tabId, tab?.url || "");
    return { ok: true, tabId, state: getState(tabId) };
  },

  async SET_MODE(message) {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false };
    if (message.mode === "download" || message.mode === "delete") {
      setState(tabId, { mode: message.mode });
    }
    return { ok: true };
  },

  async RESET() {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false };
    const state = getState(tabId);
    setState(tabId, { ...freshState(state.url), mode: state.mode });
    return { ok: true };
  },

  async DISMISS_NOTICE() {
    const tabId = await getActiveTabId();
    if (!tabId) return { ok: false };
    setState(tabId, { notice: null });
    return { ok: true };
  },
};
