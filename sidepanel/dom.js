// Single source of element references. Keeps every other panel module
// pointing at stable objects instead of sprinkling getElementById calls.

export const app = document.getElementById("app");
export const tabBar = document.getElementById("tab-bar");

export const panels = {
  download: document.getElementById("panel-download"),
  delete: document.getElementById("panel-delete"),
};

export const views = {
  loading: document.getElementById("view-loading"),
  empty: document.getElementById("view-empty"),
  // download
  ready: document.getElementById("view-ready"),
  scanning: document.getElementById("view-scanning"),
  confirm: document.getElementById("view-confirm"),
  downloading: document.getElementById("view-downloading"),
  done: document.getElementById("view-done"),
  // delete
  "del-ready": document.getElementById("view-del-ready"),
  "del-scanning": document.getElementById("view-del-scanning"),
  "del-confirm": document.getElementById("view-del-confirm"),
  "del-deleting": document.getElementById("view-del-deleting"),
  "del-verifying": document.getElementById("view-del-verifying"),
  "del-done": document.getElementById("view-del-done"),
};

export const DELETE_VIEWS = new Set([
  "del-ready",
  "del-scanning",
  "del-confirm",
  "del-deleting",
  "del-verifying",
  "del-done",
]);

export const els = {
  scanText: document.getElementById("scan-text"),
  confirmCount: document.getElementById("confirm-count"),
  zipName: document.getElementById("zip-name"),
  progressBar: document.getElementById("progress-bar"),
  progressText: document.getElementById("progress-text"),
  progressFailed: document.getElementById("progress-failed"),
  doneText: document.getElementById("done-text"),
  notice: document.getElementById("notice"),
  noticeText: document.getElementById("notice-text"),
  delScanText: document.getElementById("del-scan-text"),
  delConfirmCount: document.getElementById("del-confirm-count"),
  delConfirmInput: document.getElementById("del-confirm-input"),
  delProgressText: document.getElementById("del-progress-text"),
  delProgressDetail: document.getElementById("del-progress-detail"),
  delProgressBar: document.getElementById("del-progress-bar"),
  delProgressLabel: document.getElementById("del-progress-label"),
  delCurrentBatch: document.getElementById("del-current-batch"),
  delSummaryStuck: document.getElementById("del-summary-stuck"),
  delSummaryStuckRow: document.getElementById("del-summary-stuck-row"),
  delVerifyText: document.getElementById("del-verify-text"),
  delDoneTitle: document.getElementById("del-done-title"),
  delSummaryBefore: document.getElementById("del-summary-before"),
  delSummaryBatches: document.getElementById("del-summary-batches"),
  delSummaryAfter: document.getElementById("del-summary-after"),
};

export const buttons = {
  scan: document.getElementById("btn-scan"),
  download: document.getElementById("btn-download"),
  rescan: document.getElementById("btn-rescan"),
  cancel: document.getElementById("btn-cancel"),
  newProject: document.getElementById("btn-new"),
  dismissNotice: document.getElementById("btn-dismiss-notice"),
  tabDownload: document.getElementById("tab-download"),
  tabDelete: document.getElementById("tab-delete"),
  delScan: document.getElementById("btn-del-scan"),
  delStart: document.getElementById("btn-del-start"),
  delBack: document.getElementById("btn-del-back"),
  delCancel: document.getElementById("btn-del-cancel"),
  delReset: document.getElementById("btn-del-reset"),
};
