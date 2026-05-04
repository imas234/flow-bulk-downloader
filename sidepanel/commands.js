// All click handlers and keyboard input wiring. Commands send messages to
// the background and return quickly — UI updates arrive later as
// STATE_UPDATE broadcasts, never from direct response payloads.

import { buttons, els, app } from "./dom.js";
import { renderNotice } from "./views.js";
import { defaultZipName } from "./util.js";
import * as panelState from "./panel-state.js";

async function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

async function sendAndShowError(type, extra = {}) {
  const res = await send(type, extra);
  if (!res?.ok && res?.error) {
    renderNotice({ kind: "error", message: res.error });
  }
  return res;
}

function wireDownload() {
  buttons.scan.addEventListener("click", async () => {
    const tabId = panelState.getActiveTabId();
    if (!tabId) return;
    panelState.setZipNameDirty(false);
    await sendAndShowError("START_SCAN", { tabId });
  });

  buttons.download.addEventListener("click", async () => {
    const zipName = els.zipName.value.trim() || defaultZipName("flow");
    await sendAndShowError("START_DOWNLOAD", { zipName });
  });

  buttons.rescan.addEventListener("click", async () => {
    const tabId = panelState.getActiveTabId();
    if (!tabId) return;
    panelState.setZipNameDirty(false);
    await send("START_SCAN", { tabId });
  });

  buttons.cancel.addEventListener("click", () => send("CANCEL"));

  buttons.newProject.addEventListener("click", async () => {
    panelState.setZipNameDirty(false);
    await send("RESET");
  });

  els.zipName.addEventListener("input", () => {
    panelState.setZipNameDirty(true);
  });
}

function wireTabs() {
  buttons.tabDownload.addEventListener("click", () =>
    send("SET_MODE", { mode: "download" })
  );
  buttons.tabDelete.addEventListener("click", () =>
    send("SET_MODE", { mode: "delete" })
  );
}

function wireDelete() {
  buttons.delScan.addEventListener("click", async () => {
    const tabId = panelState.getActiveTabId();
    if (!tabId) return;
    await sendAndShowError("START_DELETE_SCAN", { tabId });
  });

  buttons.delStart.addEventListener("click", async () => {
    if (els.delConfirmInput.value !== "DELETE") return;
    await sendAndShowError("START_DELETE");
  });

  buttons.delBack.addEventListener("click", () => send("RESET_DELETE"));

  buttons.delCancel.addEventListener("click", async () => {
    buttons.delCancel.disabled = true;
    buttons.delCancel.textContent = "Stopping…";
    await send("CANCEL_DELETE");
  });

  buttons.delReset.addEventListener("click", async () => {
    resetCancelButton();
    await send("RESET_DELETE");
  });

  els.delConfirmInput.addEventListener("input", () => {
    buttons.delStart.disabled = els.delConfirmInput.value !== "DELETE";
    els.delConfirmInput.classList.toggle(
      "armed",
      els.delConfirmInput.value === "DELETE"
    );
  });

  // Once we leave the deleting view, the "Stopping…" label is stale — reset
  // it so a future deletion shows the correct call-to-action.
  new MutationObserver(() => {
    const state = panelState.getLastState();
    if (!state) return;
    if (state.deletePhase !== "deleting") resetCancelButton();
  }).observe(app, { attributes: true, attributeFilter: ["data-phase"] });
}

function resetCancelButton() {
  buttons.delCancel.disabled = false;
  buttons.delCancel.textContent = "Stop after current batch";
}

function wireNotice() {
  buttons.dismissNotice.addEventListener("click", () => send("DISMISS_NOTICE"));
}

export function wireCommands() {
  wireTabs();
  wireDownload();
  wireDelete();
  wireNotice();
}
