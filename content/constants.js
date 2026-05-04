// Timing and concurrency knobs shared across scan / download / delete flows.
// Tuning these affects how long each phase takes and how gracefully the UI
// keeps up with Flow's virtualized scroll list.
(() => {
  const FB = (window.__FlowBulk ||= {});
  FB.constants = {
    SCROLL_PAUSE: 600,      // ms to wait for the virtual list to settle after scroll
    SCROLL_STEP: 800,       // px per scroll step
    CONCURRENCY: 4,         // parallel image fetches during download
    DELETE_PAUSE: 1500,     // ms after confirming deletion for DOM to settle
    DIALOG_WAIT: 800,       // ms for the confirmation dialog to appear
  };
  FB.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
})();
