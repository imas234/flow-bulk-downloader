// Service worker entry. Installs tab lifecycle listeners and a single
// chrome.runtime.onMessage dispatcher that routes each message type to its
// handler in the panel / download / delete modules.

import { installLifecycleListeners } from "./tabs.js";
import { hydrationPromise } from "./state.js";
import { panelHandlers } from "./handlers-panel.js";
import { downloadHandlers } from "./handlers-download.js";
import { deleteHandlers } from "./handlers-delete.js";

const handlers = {
  ...panelHandlers,
  ...downloadHandlers,
  ...deleteHandlers,
};

installLifecycleListeners();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) {
    sendResponse({ ok: true });
    return false;
  }
  (async () => {
    try {
      // Hydrate before any state read — on SW wake-up the in-memory map is
      // empty until session storage finishes loading. Without this, the
      // first PANEL_READY after a wake races and returns freshState().
      await hydrationPromise;
      const reply = await handler(message, sender);
      sendResponse(reply);
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || "Unexpected error" });
    }
  })();
  return true;
});
