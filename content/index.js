// Entry point: guards against double initialization and dispatches runtime
// messages to the download / delete handlers. All logic lives in the modules
// loaded before this one; this file is just wiring.
(() => {
  if (window.__FlowBulkLoaded) return;
  window.__FlowBulkLoaded = true;

  const FB = window.__FlowBulk;
  const { download, del } = FB;

  chrome.runtime.onMessage.addListener((message) => {
    switch (message?.type) {
      case "SCAN":
        download.handleScan();
        break;
      case "DOWNLOAD":
        download.handleDownload(
          message.urls || download.getCollectedUrls(),
          message.zipName || "flow_download.zip"
        );
        break;
      case "CANCEL":
        download.abort();
        chrome.runtime.sendMessage({ type: "CANCELLED" });
        break;
      case "DELETE_SCAN":
        del.handleDeleteScan();
        break;
      case "DELETE_START":
        del.handleDeleteStart(
          message.initialCount || 0,
          message.initialBatches || 0
        );
        break;
      case "DELETE_CANCEL":
        del.abort();
        break;
    }
  });
})();
