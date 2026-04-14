# Spec: Flow Bulk Downloader — Extension Overhaul

## 1. Overview

Replace the current "one download per image" popup with a full wizard-style side panel that detects Flow project pages automatically, scrolls to discover all lazy-loaded images, bundles them into a ZIP (client-side), and downloads a single file — mirroring the behavior of the provided console script.

---

## 2. Reference Script

The following console script is the functional reference for all image-discovery, fetching, ZIP-building, and download logic. It should be stored in the repository as `reference/console-script.js` (not loaded by the extension — purely for documentation). All content-script logic must reproduce its behavior.

```js
/**
 * Google Flow — Bulk Image Downloader (Console Script)
 *
 * Scrolls through the entire Flow project, collects every generated image,
 * fetches them as blobs, packs them into a ZIP, and triggers a download.
 *
 * Usage: paste into DevTools console while on a Flow project page.
 *
 * No external libraries. Pure JS + JSDoc.
 */
(async function FlowBulkDownload() {
  "use strict";

  const SCROLL_PAUSE = 600;
  const SCROLL_STEP = 800;
  const CONCURRENCY = 4;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findScrollContainer() {
    const probe = document.querySelector('img[alt="Generated image"]');
    if (!probe) return null;
    let el = probe.parentElement;
    while (el && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if (
        el.scrollHeight > el.clientHeight + 20 &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return document.documentElement;
  }

  function collectImageUrls() {
    const urls = new Set();
    document.querySelectorAll('img[alt="Generated image"]').forEach((img) => {
      if (img.src) urls.add(img.src);
    });
    return [...urls];
  }

  function makeFilename(url, index) {
    try {
      const id = new URL(url).searchParams.get("name") || "";
      const short = id.split("-")[0] || String(index);
      return `flow_${String(index + 1).padStart(3, "0")}_${short}.jpg`;
    } catch {
      return `flow_${String(index + 1).padStart(3, "0")}.jpg`;
    }
  }

  async function fetchImage(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.arrayBuffer();
  }

  function buildZip(entries) {
    const w16 = (view, offset, value) => view.setUint16(offset, value, true);
    const w32 = (view, offset, value) => view.setUint32(offset, value, true);

    function crc32(buf) {
      let table = crc32.table;
      if (!table) {
        table = crc32.table = [];
        for (let n = 0; n < 256; n++) {
          let c = n;
          for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          }
          table[n] = c;
        }
      }
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    const encoder = new TextEncoder();
    const meta = [];
    const parts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const fileData = new Uint8Array(entry.data);
      const crc = crc32(fileData);
      const header = new ArrayBuffer(30 + nameBytes.length);
      const hv = new DataView(header);
      w32(hv, 0, 0x04034b50);
      w16(hv, 4, 20);
      w16(hv, 6, 0);
      w16(hv, 8, 0);
      w16(hv, 10, 0);
      w16(hv, 12, 0);
      w32(hv, 14, crc);
      w32(hv, 18, fileData.length);
      w32(hv, 22, fileData.length);
      w16(hv, 26, nameBytes.length);
      w16(hv, 28, 0);
      new Uint8Array(header).set(nameBytes, 30);
      meta.push({ localOffset: offset, nameBytes, crc, size: fileData.length });
      parts.push(header, fileData.buffer);
      offset += header.byteLength + fileData.length;
    }

    const cdStart = offset;
    for (const m of meta) {
      const cd = new ArrayBuffer(46 + m.nameBytes.length);
      const cv = new DataView(cd);
      w32(cv, 0, 0x02014b50);
      w16(cv, 4, 20);
      w16(cv, 6, 20);
      w16(cv, 8, 0);
      w16(cv, 10, 0);
      w16(cv, 12, 0);
      w16(cv, 14, 0);
      w32(cv, 16, m.crc);
      w32(cv, 20, m.size);
      w32(cv, 24, m.size);
      w16(cv, 28, m.nameBytes.length);
      w16(cv, 30, 0);
      w16(cv, 32, 0);
      w16(cv, 34, 0);
      w16(cv, 36, 0);
      w32(cv, 38, 0);
      w32(cv, 42, m.localOffset);
      new Uint8Array(cd).set(m.nameBytes, 46);
      parts.push(cd);
      offset += cd.byteLength;
    }

    const cdSize = offset - cdStart;
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    w32(ev, 0, 0x06054b50);
    w16(ev, 4, 0);
    w16(ev, 6, 0);
    w16(ev, 8, entries.length);
    w16(ev, 10, entries.length);
    w32(ev, 12, cdSize);
    w32(ev, 16, cdStart);
    w16(ev, 20, 0);
    parts.push(eocd);

    return new Blob(parts, { type: "application/zip" });
  }

  function log(msg) {
    console.log(
      `%c[FlowDL]%c ${msg}`,
      "color:#facc15;font-weight:bold",
      "color:inherit"
    );
  }

  log("Starting bulk download…");

  const container = findScrollContainer();
  if (!container) {
    log("❌ No generated images found on this page.");
    return;
  }

  log("Found scroll container.");
  log("Scrolling to load all images…");
  const allUrls = new Set();
  container.scrollTop = 0;
  await sleep(SCROLL_PAUSE);

  while (true) {
    collectImageUrls().forEach((u) => allUrls.add(u));
    const before = container.scrollTop;
    container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
    await sleep(SCROLL_PAUSE);
    if (container.scrollTop === before) break;
  }

  collectImageUrls().forEach((u) => allUrls.add(u));
  const urls = [...allUrls];
  log(`Discovered ${urls.length} unique image(s).`);

  if (urls.length === 0) {
    log("❌ No images to download.");
    return;
  }

  log(`Fetching images (concurrency: ${CONCURRENCY})…`);
  const zipEntries = [];
  let completed = 0;

  async function process(url, index) {
    try {
      const data = await fetchImage(url);
      zipEntries.push({ name: makeFilename(url, index), data });
    } catch (err) {
      log(`⚠ Failed to fetch image ${index + 1}: ${err.message}`);
    }
    completed++;
    if (completed % 5 === 0 || completed === urls.length) {
      log(`  ↳ ${completed} / ${urls.length}`);
    }
  }

  const pool = [];
  for (let i = 0; i < urls.length; i++) {
    const p = process(urls[i], i);
    pool.push(p);
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool);
      for (let j = pool.length - 1; j >= 0; j--) {
        const settled = await Promise.race([
          pool[j].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) pool.splice(j, 1);
      }
    }
  }
  await Promise.all(pool);

  log(`Fetched ${zipEntries.length} image(s). Building ZIP…`);
  zipEntries.sort((a, b) => a.name.localeCompare(b.name));

  const zipBlob = buildZip(zipEntries);
  const projectId =
    location.pathname.match(/project\/([^/]+)/)?.[1]?.slice(0, 8) || "flow";
  const zipName = `flow_${projectId}_${Date.now()}.zip`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);

  log(`✅ Done! Downloading "${zipName}" (${(zipBlob.size / 1024 / 1024).toFixed(1)} MB)`);
})();
```

---

## 3. Current Codebase (Baseline)

```
flow-bulk-downloader/
├── .gitkeep
├── README.md
├── manifest.json      ← MV3, permissions: activeTab, scripting, downloads
├── popup.html         ← 240px-wide popup with one button + status <p>
└── popup.js           ← Injects script to grab all <img src> + background-image URLs,
                          then fires chrome.downloads.download() per URL (no ZIP, no scroll)
```

**Key gaps vs. the reference script:**

- No scroll-to-discover — only grabs images currently in the DOM.
- Grabs *all* images on the page, not just `img[alt="Generated image"]`.
- Downloads individual files — no ZIP bundling.
- No progress reporting.
- No Flow-page detection or icon badge.
- No side panel — uses a tiny popup.

---

## 4. Proposed File Structure

```
flow-bulk-downloader/
├── reference/
│   └── console-script.js        ← NEW — the reference script (not loaded by extension)
├── icons/
│   ├── icon-16.png              ← NEW — toolbar icon (gray/inactive variant)
│   ├── icon-32.png              ← NEW
│   ├── icon-48.png              ← NEW
│   ├── icon-128.png             ← NEW
│   ├── icon-16-active.png       ← NEW — colored/active variant (Flow page detected)
│   ├── icon-32-active.png       ← NEW
│   ├── icon-48-active.png       ← NEW
│   └── icon-128-active.png      ← NEW
├── manifest.json                ← MODIFY
├── background.js                ← NEW — service worker
├── content-script.js            ← NEW — injected into Flow pages, does the heavy lifting
├── sidepanel.html               ← NEW — replaces popup.html
├── sidepanel.js                 ← NEW — wizard UI logic
├── sidepanel.css                ← NEW — styles for the side panel
├── popup.html                   ← DELETE (replaced by side panel)
├── popup.js                     ← DELETE (replaced by side panel)
├── README.md                    ← MODIFY
└── .gitkeep
```

---

## 5. Detailed Changes

### 5.1 `manifest.json` — MODIFY

Changes required:

1. **Bump version** to `"0.2.0"`.
2. **Add `"sidePanel"` permission** — needed for `chrome.sidePanel` API.
3. **Add `"tabs"` permission** — needed for `chrome.tabs.onUpdated` listener in the background to detect Flow URLs.
4. **Keep existing permissions**: `activeTab`, `scripting`, `downloads`.
5. **Remove `"action.default_popup"`** — the action click should now open the side panel, not a popup.
6. **Add `"side_panel"` key** pointing to `sidepanel.html`.
7. **Add `"background"` key** with `"service_worker": "background.js"`.
8. **Add `"content_scripts"` key** — match pattern `"https://labs.google/fx/tools/flow/project/*"`, inject `content-script.js`. This ensures the content script is ready on Flow pages without needing `chrome.scripting.executeScript`.
9. **Add `"icons"` key** — point to the gray (inactive) icon set.
10. **Add `"action"` icons** — use the gray (inactive) set as defaults.

### 5.2 `background.js` — NEW (Service Worker)

Responsibilities:

**A) Flow page detection via `chrome.tabs.onUpdated`**

Listen for tab URL changes. When a tab's URL matches the pattern `https://labs.google/fx/tools/flow/project/*`:

- Set the action icon to the **active** (colored) icon set using `chrome.action.setIcon({ tabId, path: { 16: "icons/icon-16-active.png", ... } })`.
- Set a badge on the action icon: `chrome.action.setBadgeText({ tabId, text: "✓" })` with a green background via `chrome.action.setBadgeBackgroundColor`.
- Enable the side panel for that specific tab using `chrome.sidePanel.setOptions({ tabId, enabled: true })`.

When a tab navigates *away* from a Flow project URL:

- Revert icon to the gray/inactive set.
- Clear the badge text.
- Disable the side panel for that tab: `chrome.sidePanel.setOptions({ tabId, enabled: false })`.

Also handle `chrome.tabs.onRemoved` to clean up any per-tab state.

**B) Open side panel on action click**

Listen for `chrome.action.onClicked`. When fired, call `chrome.sidePanel.open({ tabId })`. (This only works if the side panel is enabled for that tab — handled above.)

**C) Message relay between side panel and content script**

The side panel (`sidepanel.js`) cannot directly communicate with the content script. The background service worker acts as a relay:

- Listen for messages from `sidepanel.js` (e.g., `{ type: "START_SCAN" }`, `{ type: "START_DOWNLOAD", zipName: "..." }`).
- Forward them to the content script in the active tab via `chrome.tabs.sendMessage(tabId, msg)`.
- Listen for messages from the content script (e.g., progress updates, scan results) and forward them to the side panel via `chrome.runtime.sendMessage(msg)` (the side panel is an extension page and can receive runtime messages).

**D) Handle ZIP download**

When the content script finishes building the ZIP blob, it cannot directly trigger a `saveAs` dialog from a content script in a reliable way. Instead:

- The content script sends the ZIP as a blob URL (created via `URL.createObjectURL` in the content script context) along with the desired filename to the background.
- The background calls `chrome.downloads.download({ url: blobUrl, filename: zipName, saveAs: true })`.
- **Important**: The `saveAs: true` option will show Chrome's native "Save As" dialog, letting the user pick the download location and confirm the filename. This replaces the need for a custom "pick location" step in the wizard.
- After the download starts, relay the download ID back to the side panel so it can track completion.

### 5.3 `content-script.js` — NEW

This is the core logic file. It contains the same algorithms as the reference console script but is restructured to communicate via `chrome.runtime.onMessage`.

**Functions ported directly from the reference script (same logic, same code):**

- `findScrollContainer()` — walks up from `img[alt="Generated image"]` to find scrollable ancestor.
- `collectImageUrls()` — queries all `img[alt="Generated image"]` and collects unique `src` values.
- `makeFilename(url, index)` — extracts UUID from `?name=` param, builds `flow_001_<short>.jpg` filenames.
- `fetchImage(url)` — fetches with `credentials: "same-origin"` (critical for the CORS redirect behavior noted in the reference script).
- `buildZip(entries)` — the full minimal ZIP builder (store-only, CRC-32, local headers, central directory, EOCD).
- `sleep(ms)` utility.

**Message handlers (`chrome.runtime.onMessage`):**

1. **`{ type: "SCAN" }`** — Perform the scroll-and-collect phase:
   - Call `findScrollContainer()`. If `null`, respond with `{ type: "SCAN_RESULT", count: 0, error: "No generated images found" }`.
   - Scroll from top to bottom using the reference script's loop (`SCROLL_STEP = 800`, `SCROLL_PAUSE = 600`), collecting URLs at each step.
   - During scrolling, periodically send `{ type: "SCAN_PROGRESS", found: currentCount }` messages so the side panel can show a live count.
   - On completion, send `{ type: "SCAN_RESULT", count: urls.length, urls: [...] }`.

2. **`{ type: "DOWNLOAD", urls: [...], zipName: "..." }`** — Perform the fetch-and-zip phase:
   - Fetch all URLs with bounded concurrency (`CONCURRENCY = 4`) using the same pool pattern from the reference script.
   - After each image is fetched (or fails), send `{ type: "DOWNLOAD_PROGRESS", completed, total, failed }`.
   - Once all fetches complete, call `buildZip(entries)` to create the blob.
   - Create a blob URL via `URL.createObjectURL(zipBlob)`.
   - Send `{ type: "ZIP_READY", blobUrl, zipName, sizeMB: (zipBlob.size / 1024 / 1024).toFixed(1) }` to the background, which will trigger `chrome.downloads.download`.

3. **`{ type: "CANCEL" }`** — Set an `aborted` flag that the fetch loop checks before starting each new fetch. Respond with `{ type: "CANCELLED" }`.

**State management:**

- The content script holds module-level variables: `collectedUrls` (the array from the scan phase), and `aborted` (boolean flag for cancellation).
- These are reset on each `SCAN` message.

### 5.4 `sidepanel.html` — NEW

The side panel HTML. Fixed width dictated by Chrome (typically ~300–400px). Structure:

```
<div id="app">
  @-- Step 1: Initial / Scan --
  <div id="step-scan" class="step active">
    <h2>Flow Bulk Downloader</h2>
    <p>Download all generated images from this Flow project as a single ZIP file.</p>
    <button id="btn-scan">Scan for Images</button>
    <div id="scan-status" class="status hidden">
      <span id="scan-spinner" class="spinner"></span>
      <span id="scan-text">Scanning...</span>
    </div>
  </div>

  @-- Step 2: Confirm --
  <div id="step-confirm" class="step hidden">
    <h2>Images Found</h2>
    <p id="confirm-count"></p>  @-- e.g., "Found 42 images" --
    <label for="zip-name">ZIP filename:</label>
    <input type="text" id="zip-name" />
    <button id="btn-download">Download ZIP</button>
    <button id="btn-rescan" class="secondary">Re-scan</button>
  </div>

  @-- Step 3: Downloading --
  <div id="step-progress" class="step hidden">
    <h2>Downloading</h2>
    <div class="progress-bar-container">
      <div id="progress-bar" class="progress-bar"></div>
    </div>
    <p id="progress-text">0 / 0 images fetched</p>
    <p id="progress-failed" class="hidden">0 failed</p>
    <button id="btn-cancel" class="danger">Cancel</button>
  </div>

  @-- Step 4: Complete --
  <div id="step-done" class="step hidden">
    <h2>Done!</h2>
    <p id="done-text"></p>  @-- e.g., "Downloaded 42 images (12.3 MB)" --
    <button id="btn-new">Download Another Project</button>
  </div>

  @-- Error state (overlays any step) --
  <div id="error-banner" class="hidden">
    <p id="error-text"></p>
    <button id="btn-dismiss-error">Dismiss</button>
  </div>
</div>
```

### 5.5 `sidepanel.js` — NEW

Controls the wizard flow. Communicates with the background service worker via `chrome.runtime.sendMessage` and listens for incoming messages via `chrome.runtime.onMessage`.

**Wizard steps:**

1. **Step 1 — Scan**: User clicks "Scan for Images". Sends `{ type: "START_SCAN" }` to background. Displays a spinner and live count as `SCAN_PROGRESS` messages arrive. When `SCAN_RESULT` arrives, transition to Step 2 (or show error if count is 0).

2. **Step 2 — Confirm**: Shows the image count (e.g., "Found 42 generated images"). Shows an editable text input pre-filled with a default ZIP name: `flow_<first8charsOfProjectId>_<YYYYMMDD>.zip` (the project ID is extracted from the tab URL, sent along with the scan result). User can edit the name. Clicking "Download ZIP" sends `{ type: "START_DOWNLOAD", zipName: "<user-edited-name>" }` to background and transitions to Step 3.

3. **Step 3 — Progress**: Shows a progress bar (`width` percentage = `completed / total * 100`). Shows text like "23 / 42 images fetched". If any failures, shows "3 failed" in a warning color. A "Cancel" button sends `{ type: "CANCEL" }`. When `ZIP_READY` message arrives (relayed from content script → background → side panel), Chrome's native Save As dialog will have been triggered by the background. Transition to Step 4.

4. **Step 4 — Done**: Shows summary: "Downloaded 42 images (12.3 MB)". A "Download Another Project" button resets back to Step 1.

**Other behaviors:**

- If the side panel is opened on a non-Flow page, show a message: "Navigate to a Google Flow project to use this extension."
- On open, the side panel should query the active tab's URL to verify it's a Flow page before enabling the Scan button.

### 5.6 `sidepanel.css` — NEW

Styles for the side panel. Design guidelines:

- Dark theme to match Flow's dark UI (background: `#1a1a1a`, text: `#e0e0e0`).
- Google-style rounded buttons (primary: filled blue `#4285f4`, secondary: outlined, danger: red `#ea4335`).
- Progress bar: container with `background: #333`, fill with `background: #4285f4`, rounded corners, smooth width transition (`transition: width 0.3s ease`).
- Spinner: CSS-only animated spinner (rotating border trick).
- Steps shown/hidden via `.hidden { display: none; }` and `.active` class.
- Font: `system-ui, -apple-system, sans-serif`.
- Padding: `16px` on the body.

### 5.7 `icons/` — NEW

Need 8 PNG icons total (2 variants × 4 sizes):

- **Inactive (gray):** `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` — shown on non-Flow pages. Grayscale/muted version of the logo.
- **Active (colored):** `icon-16-active.png`, `icon-32-active.png`, `icon-48-active.png`, `icon-128-active.png` — shown when a Flow project page is detected. Full-color version.

Design suggestion: a simple download-arrow icon overlaid on a grid/image symbol, referencing the "bulk image download" concept.

### 5.8 `popup.html` — DELETE

No longer needed; replaced by the side panel.

### 5.9 `popup.js` — DELETE

No longer needed; replaced by `sidepanel.js` + `content-script.js` + `background.js`.

### 5.10 `README.md` — MODIFY

Update to reflect the new architecture, new install/usage instructions, and the wizard-based UX. Mention the reference script in `reference/`.

---

## 6. Message Protocol

All messages use `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with a `type` field.

| Direction | Type | Payload | Description |
|---|---|---|---|
| SidePanel → Background | `START_SCAN` | `{ tabId }` | User clicked "Scan for Images" |
| Background → ContentScript | `SCAN` | — | Forwarded scan command |
| ContentScript → Background | `SCAN_PROGRESS` | `{ found: number }` | Live count during scrolling |
| Background → SidePanel | `SCAN_PROGRESS` | `{ found: number }` | Relayed to update UI |
| ContentScript → Background | `SCAN_RESULT` | `{ count, urls, projectId, error? }` | Scan complete |
| Background → SidePanel | `SCAN_RESULT` | `{ count, projectId, error? }` | Relayed (URLs held in background, not sent to panel) |
| SidePanel → Background | `START_DOWNLOAD` | `{ zipName }` | User confirmed download |
| Background → ContentScript | `DOWNLOAD` | `{ urls, zipName }` | Forwarded with stored URLs |
| ContentScript → Background | `DOWNLOAD_PROGRESS` | `{ completed, total, failed }` | Per-image progress |
| Background → SidePanel | `DOWNLOAD_PROGRESS` | `{ completed, total, failed }` | Relayed for progress bar |
| ContentScript → Background | `ZIP_READY` | `{ blobUrl, zipName, sizeMB }` | ZIP built, blob URL ready |
| Background → SidePanel | `DOWNLOAD_COMPLETE` | `{ sizeMB, downloadId }` | After `chrome.downloads.download` fires |
| SidePanel → Background | `CANCEL` | — | User clicked Cancel |
| Background → ContentScript | `CANCEL` | — | Forwarded abort signal |
| ContentScript → Background | `CANCELLED` | — | Acknowledged |
| Background → SidePanel | `CANCELLED` | — | Relayed |

---

## 7. Key Implementation Notes

### 7.1 CORS / Credentials

The reference script documents a critical detail: `fetch(url, { credentials: "same-origin" })` must be used (not `"include"`). The initial request to the Google media endpoint is same-origin and sends cookies for authentication. It then redirects to a cross-origin CDN that returns `Access-Control-Allow-Origin: *`. Using `"include"` would fail because the browser requires `Access-Control-Allow-Credentials: true` with a non-wildcard ACAO when credentials are included. This must be preserved in `content-script.js`.

### 7.2 Content Script vs. Background Fetch

Image fetching **must** happen in the content script, not the background service worker. The content script runs in the page's origin (`labs.google`), so `same-origin` credential mode correctly sends the session cookies for the initial media request. The background service worker runs in the extension's origin and would not have the page's cookies.

### 7.3 Blob URL Lifetime

The content script creates the blob URL with `URL.createObjectURL`. This URL is scoped to the content script's document (the Flow page). The background can pass this blob URL to `chrome.downloads.download`, which can access it because the download is initiated from the extension context but the URL is still valid as long as the page hasn't navigated away. The content script should revoke the blob URL only after receiving confirmation that the download has started.

### 7.4 Side Panel API

The `chrome.sidePanel` API (Chrome 114+) is used instead of the deprecated sidebar or a popup. Key API calls:

- `chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true/false })` — enable/disable per tab.
- `chrome.sidePanel.open({ tabId })` — programmatically open (requires user gesture, which the action click provides).
- The manifest's `"side_panel"` key sets the default path.

### 7.5 Save As Dialog

Chrome's `chrome.downloads.download({ saveAs: true })` triggers the native OS file picker, letting the user choose the download location and edit the filename. This is simpler and more reliable than building a custom directory picker in the extension UI. The wizard's Step 2 lets the user pre-set the filename (which becomes the `filename` option in the download call), and `saveAs: true` gives them the final confirmation.

### 7.6 Cancellation

The content script's fetch loop checks an `aborted` flag before starting each new fetch. When `CANCEL` is received, the flag is set to `true`. Any in-flight fetches will complete (we don't abort them mid-flight), but no new fetches will start. The partially-fetched entries are discarded — no partial ZIP is created.

### 7.7 Tab Navigation During Download

If the user navigates away from the Flow page while a download is in progress, the content script is destroyed. The background should detect this via `chrome.tabs.onUpdated` (URL change) and send a `{ type: "DOWNLOAD_ABORTED", reason: "Page navigated away" }` message to the side panel.

---

## 8. Permissions Summary

| Permission | Why |
|---|---|
| `activeTab` | Access the active tab when the user clicks the extension icon |
| `scripting` | Inject the content script programmatically (fallback if declarative injection fails) |
| `downloads` | Trigger `chrome.downloads.download` for the ZIP file with `saveAs: true` |
| `sidePanel` | Use the `chrome.sidePanel` API |
| `tabs` | Listen to `chrome.tabs.onUpdated` for URL-based Flow page detection |

Host permissions remain the same: `https://*.google.com/*` and `https://*.googleusercontent.com/*`.

---

## 9. UX Flow Summary

1. User installs extension. Icon appears gray in toolbar on all pages.
2. User navigates to `https://labs.google/fx/tools/flow/project/...`. The background detects this, swaps the icon to the colored/active variant, and shows a green "✓" badge.
3. User clicks the extension icon. The side panel opens on the right side of the browser (like Claude's panel).
4. **Step 1 — Scan**: Panel shows a description and a "Scan for Images" button. User clicks it. The panel shows a spinner with a live count ("Found 17 images so far...") as the content script scrolls through the page.
5. **Step 2 — Confirm**: Panel shows "Found 42 images". An editable text field shows the default ZIP filename. User can edit it. User clicks "Download ZIP".
6. **Step 3 — Progress**: Panel shows a progress bar filling as images are fetched. Text shows "23 / 42 images fetched". If any fail, a warning line appears.
7. Chrome's native **Save As dialog** appears (from `saveAs: true`), letting the user pick a save location and confirm the filename.
8. **Step 4 — Done**: Panel shows "Done! Downloaded 42 images (12.3 MB)". A "Download Another Project" button resets the wizard.---

# Spec: Flow Bulk Downloader — Extension Overhaul

## 1. Overview

Replace the current "one download per image" popup with a full wizard-style side panel that detects Flow project pages automatically, scrolls to discover all lazy-loaded images, bundles them into a ZIP (client-side), and downloads a single file — mirroring the behavior of the provided console script.

---

## 2. Reference Script

The following console script is the functional reference for all image-discovery, fetching, ZIP-building, and download logic. It should be stored in the repository as `reference/console-script.js` (not loaded by the extension — purely for documentation). All content-script logic must reproduce its behavior.

```js
/**
 * Google Flow — Bulk Image Downloader (Console Script)
 *
 * Scrolls through the entire Flow project, collects every generated image,
 * fetches them as blobs, packs them into a ZIP, and triggers a download.
 *
 * Usage: paste into DevTools console while on a Flow project page.
 *
 * No external libraries. Pure JS + JSDoc.
 */
(async function FlowBulkDownload() {
  "use strict";

  const SCROLL_PAUSE = 600;
  const SCROLL_STEP = 800;
  const CONCURRENCY = 4;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findScrollContainer() {
    const probe = document.querySelector('img[alt="Generated image"]');
    if (!probe) return null;
    let el = probe.parentElement;
    while (el && el !== document.documentElement) {
      const style = getComputedStyle(el);
      if (
        el.scrollHeight > el.clientHeight + 20 &&
        (style.overflowY === "auto" || style.overflowY === "scroll")
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return document.documentElement;
  }

  function collectImageUrls() {
    const urls = new Set();
    document.querySelectorAll('img[alt="Generated image"]').forEach((img) => {
      if (img.src) urls.add(img.src);
    });
    return [...urls];
  }

  function makeFilename(url, index) {
    try {
      const id = new URL(url).searchParams.get("name") || "";
      const short = id.split("-")[0] || String(index);
      return `flow_${String(index + 1).padStart(3, "0")}_${short}.jpg`;
    } catch {
      return `flow_${String(index + 1).padStart(3, "0")}.jpg`;
    }
  }

  async function fetchImage(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.arrayBuffer();
  }

  function buildZip(entries) {
    const w16 = (view, offset, value) => view.setUint16(offset, value, true);
    const w32 = (view, offset, value) => view.setUint32(offset, value, true);

    function crc32(buf) {
      let table = crc32.table;
      if (!table) {
        table = crc32.table = [];
        for (let n = 0; n < 256; n++) {
          let c = n;
          for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          }
          table[n] = c;
        }
      }
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    const encoder = new TextEncoder();
    const meta = [];
    const parts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const fileData = new Uint8Array(entry.data);
      const crc = crc32(fileData);
      const header = new ArrayBuffer(30 + nameBytes.length);
      const hv = new DataView(header);
      w32(hv, 0, 0x04034b50);
      w16(hv, 4, 20);
      w16(hv, 6, 0);
      w16(hv, 8, 0);
      w16(hv, 10, 0);
      w16(hv, 12, 0);
      w32(hv, 14, crc);
      w32(hv, 18, fileData.length);
      w32(hv, 22, fileData.length);
      w16(hv, 26, nameBytes.length);
      w16(hv, 28, 0);
      new Uint8Array(header).set(nameBytes, 30);
      meta.push({ localOffset: offset, nameBytes, crc, size: fileData.length });
      parts.push(header, fileData.buffer);
      offset += header.byteLength + fileData.length;
    }

    const cdStart = offset;
    for (const m of meta) {
      const cd = new ArrayBuffer(46 + m.nameBytes.length);
      const cv = new DataView(cd);
      w32(cv, 0, 0x02014b50);
      w16(cv, 4, 20);
      w16(cv, 6, 20);
      w16(cv, 8, 0);
      w16(cv, 10, 0);
      w16(cv, 12, 0);
      w16(cv, 14, 0);
      w32(cv, 16, m.crc);
      w32(cv, 20, m.size);
      w32(cv, 24, m.size);
      w16(cv, 28, m.nameBytes.length);
      w16(cv, 30, 0);
      w16(cv, 32, 0);
      w16(cv, 34, 0);
      w16(cv, 36, 0);
      w32(cv, 38, 0);
      w32(cv, 42, m.localOffset);
      new Uint8Array(cd).set(m.nameBytes, 46);
      parts.push(cd);
      offset += cd.byteLength;
    }

    const cdSize = offset - cdStart;
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    w32(ev, 0, 0x06054b50);
    w16(ev, 4, 0);
    w16(ev, 6, 0);
    w16(ev, 8, entries.length);
    w16(ev, 10, entries.length);
    w32(ev, 12, cdSize);
    w32(ev, 16, cdStart);
    w16(ev, 20, 0);
    parts.push(eocd);

    return new Blob(parts, { type: "application/zip" });
  }

  function log(msg) {
    console.log(
      `%c[FlowDL]%c ${msg}`,
      "color:#facc15;font-weight:bold",
      "color:inherit"
    );
  }

  log("Starting bulk download…");

  const container = findScrollContainer();
  if (!container) {
    log("❌ No generated images found on this page.");
    return;
  }

  log("Found scroll container.");
  log("Scrolling to load all images…");
  const allUrls = new Set();
  container.scrollTop = 0;
  await sleep(SCROLL_PAUSE);

  while (true) {
    collectImageUrls().forEach((u) => allUrls.add(u));
    const before = container.scrollTop;
    container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
    await sleep(SCROLL_PAUSE);
    if (container.scrollTop === before) break;
  }

  collectImageUrls().forEach((u) => allUrls.add(u));
  const urls = [...allUrls];
  log(`Discovered ${urls.length} unique image(s).`);

  if (urls.length === 0) {
    log("❌ No images to download.");
    return;
  }

  log(`Fetching images (concurrency: ${CONCURRENCY})…`);
  const zipEntries = [];
  let completed = 0;

  async function process(url, index) {
    try {
      const data = await fetchImage(url);
      zipEntries.push({ name: makeFilename(url, index), data });
    } catch (err) {
      log(`⚠ Failed to fetch image ${index + 1}: ${err.message}`);
    }
    completed++;
    if (completed % 5 === 0 || completed === urls.length) {
      log(`  ↳ ${completed} / ${urls.length}`);
    }
  }

  const pool = [];
  for (let i = 0; i < urls.length; i++) {
    const p = process(urls[i], i);
    pool.push(p);
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool);
      for (let j = pool.length - 1; j >= 0; j--) {
        const settled = await Promise.race([
          pool[j].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) pool.splice(j, 1);
      }
    }
  }
  await Promise.all(pool);

  log(`Fetched ${zipEntries.length} image(s). Building ZIP…`);
  zipEntries.sort((a, b) => a.name.localeCompare(b.name));

  const zipBlob = buildZip(zipEntries);
  const projectId =
    location.pathname.match(/project\/([^/]+)/)?.[1]?.slice(0, 8) || "flow";
  const zipName = `flow_${projectId}_${Date.now()}.zip`;

  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);

  log(`✅ Done! Downloading "${zipName}" (${(zipBlob.size / 1024 / 1024).toFixed(1)} MB)`);
})();
```

---

## 3. Current Codebase (Baseline)

```
flow-bulk-downloader/
├── .gitkeep
├── README.md
├── manifest.json      ← MV3, permissions: activeTab, scripting, downloads
├── popup.html         ← 240px-wide popup with one button + status <p>
└── popup.js           ← Injects script to grab all <img src> + background-image URLs,
                          then fires chrome.downloads.download() per URL (no ZIP, no scroll)
```

**Key gaps vs. the reference script:**

- No scroll-to-discover — only grabs images currently in the DOM.
- Grabs *all* images on the page, not just `img[alt="Generated image"]`.
- Downloads individual files — no ZIP bundling.
- No progress reporting.
- No Flow-page detection or icon badge.
- No side panel — uses a tiny popup.

---

## 4. Proposed File Structure

```
flow-bulk-downloader/
├── reference/
│   └── console-script.js        ← NEW — the reference script (not loaded by extension)
├── icons/
│   ├── icon-16.png              ← NEW — toolbar icon (gray/inactive variant)
│   ├── icon-32.png              ← NEW
│   ├── icon-48.png              ← NEW
│   ├── icon-128.png             ← NEW
│   ├── icon-16-active.png       ← NEW — colored/active variant (Flow page detected)
│   ├── icon-32-active.png       ← NEW
│   ├── icon-48-active.png       ← NEW
│   └── icon-128-active.png      ← NEW
├── manifest.json                ← MODIFY
├── background.js                ← NEW — service worker
├── content-script.js            ← NEW — injected into Flow pages, does the heavy lifting
├── sidepanel.html               ← NEW — replaces popup.html
├── sidepanel.js                 ← NEW — wizard UI logic
├── sidepanel.css                ← NEW — styles for the side panel
├── popup.html                   ← DELETE (replaced by side panel)
├── popup.js                     ← DELETE (replaced by side panel)
├── README.md                    ← MODIFY
└── .gitkeep
```

---

## 5. Detailed Changes

### 5.1 `manifest.json` — MODIFY

Changes required:

1. **Bump version** to `"0.2.0"`.
2. **Add `"sidePanel"` permission** — needed for `chrome.sidePanel` API.
3. **Add `"tabs"` permission** — needed for `chrome.tabs.onUpdated` listener in the background to detect Flow URLs.
4. **Keep existing permissions**: `activeTab`, `scripting`, `downloads`.
5. **Remove `"action.default_popup"`** — the action click should now open the side panel, not a popup.
6. **Add `"side_panel"` key** pointing to `sidepanel.html`.
7. **Add `"background"` key** with `"service_worker": "background.js"`.
8. **Add `"content_scripts"` key** — match pattern `"https://labs.google/fx/tools/flow/project/*"`, inject `content-script.js`. This ensures the content script is ready on Flow pages without needing `chrome.scripting.executeScript`.
9. **Add `"icons"` key** — point to the gray (inactive) icon set.
10. **Add `"action"` icons** — use the gray (inactive) set as defaults.

### 5.2 `background.js` — NEW (Service Worker)

Responsibilities:

**A) Flow page detection via `chrome.tabs.onUpdated`**

Listen for tab URL changes. When a tab's URL matches the pattern `https://labs.google/fx/tools/flow/project/*`:

- Set the action icon to the **active** (colored) icon set using `chrome.action.setIcon({ tabId, path: { 16: "icons/icon-16-active.png", ... } })`.
- Set a badge on the action icon: `chrome.action.setBadgeText({ tabId, text: "✓" })` with a green background via `chrome.action.setBadgeBackgroundColor`.
- Enable the side panel for that specific tab using `chrome.sidePanel.setOptions({ tabId, enabled: true })`.

When a tab navigates *away* from a Flow project URL:

- Revert icon to the gray/inactive set.
- Clear the badge text.
- Disable the side panel for that tab: `chrome.sidePanel.setOptions({ tabId, enabled: false })`.

Also handle `chrome.tabs.onRemoved` to clean up any per-tab state.

**B) Open side panel on action click**

Listen for `chrome.action.onClicked`. When fired, call `chrome.sidePanel.open({ tabId })`. (This only works if the side panel is enabled for that tab — handled above.)

**C) Message relay between side panel and content script**

The side panel (`sidepanel.js`) cannot directly communicate with the content script. The background service worker acts as a relay:

- Listen for messages from `sidepanel.js` (e.g., `{ type: "START_SCAN" }`, `{ type: "START_DOWNLOAD", zipName: "..." }`).
- Forward them to the content script in the active tab via `chrome.tabs.sendMessage(tabId, msg)`.
- Listen for messages from the content script (e.g., progress updates, scan results) and forward them to the side panel via `chrome.runtime.sendMessage(msg)` (the side panel is an extension page and can receive runtime messages).

**D) Handle ZIP download**

When the content script finishes building the ZIP blob, it cannot directly trigger a `saveAs` dialog from a content script in a reliable way. Instead:

- The content script sends the ZIP as a blob URL (created via `URL.createObjectURL` in the content script context) along with the desired filename to the background.
- The background calls `chrome.downloads.download({ url: blobUrl, filename: zipName, saveAs: true })`.
- **Important**: The `saveAs: true` option will show Chrome's native "Save As" dialog, letting the user pick the download location and confirm the filename. This replaces the need for a custom "pick location" step in the wizard.
- After the download starts, relay the download ID back to the side panel so it can track completion.

### 5.3 `content-script.js` — NEW

This is the core logic file. It contains the same algorithms as the reference console script but is restructured to communicate via `chrome.runtime.onMessage`.

**Functions ported directly from the reference script (same logic, same code):**

- `findScrollContainer()` — walks up from `img[alt="Generated image"]` to find scrollable ancestor.
- `collectImageUrls()` — queries all `img[alt="Generated image"]` and collects unique `src` values.
- `makeFilename(url, index)` — extracts UUID from `?name=` param, builds `flow_001_<short>.jpg` filenames.
- `fetchImage(url)` — fetches with `credentials: "same-origin"` (critical for the CORS redirect behavior noted in the reference script).
- `buildZip(entries)` — the full minimal ZIP builder (store-only, CRC-32, local headers, central directory, EOCD).
- `sleep(ms)` utility.

**Message handlers (`chrome.runtime.onMessage`):**

1. **`{ type: "SCAN" }`** — Perform the scroll-and-collect phase:
   - Call `findScrollContainer()`. If `null`, respond with `{ type: "SCAN_RESULT", count: 0, error: "No generated images found" }`.
   - Scroll from top to bottom using the reference script's loop (`SCROLL_STEP = 800`, `SCROLL_PAUSE = 600`), collecting URLs at each step.
   - During scrolling, periodically send `{ type: "SCAN_PROGRESS", found: currentCount }` messages so the side panel can show a live count.
   - On completion, send `{ type: "SCAN_RESULT", count: urls.length, urls: [...] }`.

2. **`{ type: "DOWNLOAD", urls: [...], zipName: "..." }`** — Perform the fetch-and-zip phase:
   - Fetch all URLs with bounded concurrency (`CONCURRENCY = 4`) using the same pool pattern from the reference script.
   - After each image is fetched (or fails), send `{ type: "DOWNLOAD_PROGRESS", completed, total, failed }`.
   - Once all fetches complete, call `buildZip(entries)` to create the blob.
   - Create a blob URL via `URL.createObjectURL(zipBlob)`.
   - Send `{ type: "ZIP_READY", blobUrl, zipName, sizeMB: (zipBlob.size / 1024 / 1024).toFixed(1) }` to the background, which will trigger `chrome.downloads.download`.

3. **`{ type: "CANCEL" }`** — Set an `aborted` flag that the fetch loop checks before starting each new fetch. Respond with `{ type: "CANCELLED" }`.

**State management:**

- The content script holds module-level variables: `collectedUrls` (the array from the scan phase), and `aborted` (boolean flag for cancellation).
- These are reset on each `SCAN` message.

### 5.4 `sidepanel.html` — NEW

The side panel HTML. Fixed width dictated by Chrome (typically ~300–400px). Structure:

```
<div id="app">
  @-- Step 1: Initial / Scan --
  <div id="step-scan" class="step active">
    <h2>Flow Bulk Downloader</h2>
    <p>Download all generated images from this Flow project as a single ZIP file.</p>
    <button id="btn-scan">Scan for Images</button>
    <div id="scan-status" class="status hidden">
      <span id="scan-spinner" class="spinner"></span>
      <span id="scan-text">Scanning...</span>
    </div>
  </div>

  @-- Step 2: Confirm --
  <div id="step-confirm" class="step hidden">
    <h2>Images Found</h2>
    <p id="confirm-count"></p>  @-- e.g., "Found 42 images" --
    <label for="zip-name">ZIP filename:</label>
    <input type="text" id="zip-name" />
    <button id="btn-download">Download ZIP</button>
    <button id="btn-rescan" class="secondary">Re-scan</button>
  </div>

  @-- Step 3: Downloading --
  <div id="step-progress" class="step hidden">
    <h2>Downloading</h2>
    <div class="progress-bar-container">
      <div id="progress-bar" class="progress-bar"></div>
    </div>
    <p id="progress-text">0 / 0 images fetched</p>
    <p id="progress-failed" class="hidden">0 failed</p>
    <button id="btn-cancel" class="danger">Cancel</button>
  </div>

  @-- Step 4: Complete --
  <div id="step-done" class="step hidden">
    <h2>Done!</h2>
    <p id="done-text"></p>  @-- e.g., "Downloaded 42 images (12.3 MB)" --
    <button id="btn-new">Download Another Project</button>
  </div>

  @-- Error state (overlays any step) --
  <div id="error-banner" class="hidden">
    <p id="error-text"></p>
    <button id="btn-dismiss-error">Dismiss</button>
  </div>
</div>
```

### 5.5 `sidepanel.js` — NEW

Controls the wizard flow. Communicates with the background service worker via `chrome.runtime.sendMessage` and listens for incoming messages via `chrome.runtime.onMessage`.

**Wizard steps:**

1. **Step 1 — Scan**: User clicks "Scan for Images". Sends `{ type: "START_SCAN" }` to background. Displays a spinner and live count as `SCAN_PROGRESS` messages arrive. When `SCAN_RESULT` arrives, transition to Step 2 (or show error if count is 0).

2. **Step 2 — Confirm**: Shows the image count (e.g., "Found 42 generated images"). Shows an editable text input pre-filled with a default ZIP name: `flow_<first8charsOfProjectId>_<YYYYMMDD>.zip` (the project ID is extracted from the tab URL, sent along with the scan result). User can edit the name. Clicking "Download ZIP" sends `{ type: "START_DOWNLOAD", zipName: "<user-edited-name>" }` to background and transitions to Step 3.

3. **Step 3 — Progress**: Shows a progress bar (`width` percentage = `completed / total * 100`). Shows text like "23 / 42 images fetched". If any failures, shows "3 failed" in a warning color. A "Cancel" button sends `{ type: "CANCEL" }`. When `ZIP_READY` message arrives (relayed from content script → background → side panel), Chrome's native Save As dialog will have been triggered by the background. Transition to Step 4.

4. **Step 4 — Done**: Shows summary: "Downloaded 42 images (12.3 MB)". A "Download Another Project" button resets back to Step 1.

**Other behaviors:**

- If the side panel is opened on a non-Flow page, show a message: "Navigate to a Google Flow project to use this extension."
- On open, the side panel should query the active tab's URL to verify it's a Flow page before enabling the Scan button.

### 5.6 `sidepanel.css` — NEW

Styles for the side panel. Design guidelines:

- Dark theme to match Flow's dark UI (background: `#1a1a1a`, text: `#e0e0e0`).
- Google-style rounded buttons (primary: filled blue `#4285f4`, secondary: outlined, danger: red `#ea4335`).
- Progress bar: container with `background: #333`, fill with `background: #4285f4`, rounded corners, smooth width transition (`transition: width 0.3s ease`).
- Spinner: CSS-only animated spinner (rotating border trick).
- Steps shown/hidden via `.hidden { display: none; }` and `.active` class.
- Font: `system-ui, -apple-system, sans-serif`.
- Padding: `16px` on the body.

### 5.7 `icons/` — NEW

Need 8 PNG icons total (2 variants × 4 sizes):

- **Inactive (gray):** `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` — shown on non-Flow pages. Grayscale/muted version of the logo.
- **Active (colored):** `icon-16-active.png`, `icon-32-active.png`, `icon-48-active.png`, `icon-128-active.png` — shown when a Flow project page is detected. Full-color version.

Design suggestion: a simple download-arrow icon overlaid on a grid/image symbol, referencing the "bulk image download" concept.

### 5.8 `popup.html` — DELETE

No longer needed; replaced by the side panel.

### 5.9 `popup.js` — DELETE

No longer needed; replaced by `sidepanel.js` + `content-script.js` + `background.js`.

### 5.10 `README.md` — MODIFY

Update to reflect the new architecture, new install/usage instructions, and the wizard-based UX. Mention the reference script in `reference/`.

---

## 6. Message Protocol

All messages use `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with a `type` field.

| Direction | Type | Payload | Description |
|---|---|---|---|
| SidePanel → Background | `START_SCAN` | `{ tabId }` | User clicked "Scan for Images" |
| Background → ContentScript | `SCAN` | — | Forwarded scan command |
| ContentScript → Background | `SCAN_PROGRESS` | `{ found: number }` | Live count during scrolling |
| Background → SidePanel | `SCAN_PROGRESS` | `{ found: number }` | Relayed to update UI |
| ContentScript → Background | `SCAN_RESULT` | `{ count, urls, projectId, error? }` | Scan complete |
| Background → SidePanel | `SCAN_RESULT` | `{ count, projectId, error? }` | Relayed (URLs held in background, not sent to panel) |
| SidePanel → Background | `START_DOWNLOAD` | `{ zipName }` | User confirmed download |
| Background → ContentScript | `DOWNLOAD` | `{ urls, zipName }` | Forwarded with stored URLs |
| ContentScript → Background | `DOWNLOAD_PROGRESS` | `{ completed, total, failed }` | Per-image progress |
| Background → SidePanel | `DOWNLOAD_PROGRESS` | `{ completed, total, failed }` | Relayed for progress bar |
| ContentScript → Background | `ZIP_READY` | `{ blobUrl, zipName, sizeMB }` | ZIP built, blob URL ready |
| Background → SidePanel | `DOWNLOAD_COMPLETE` | `{ sizeMB, downloadId }` | After `chrome.downloads.download` fires |
| SidePanel → Background | `CANCEL` | — | User clicked Cancel |
| Background → ContentScript | `CANCEL` | — | Forwarded abort signal |
| ContentScript → Background | `CANCELLED` | — | Acknowledged |
| Background → SidePanel | `CANCELLED` | — | Relayed |

---

## 7. Key Implementation Notes

### 7.1 CORS / Credentials

The reference script documents a critical detail: `fetch(url, { credentials: "same-origin" })` must be used (not `"include"`). The initial request to the Google media endpoint is same-origin and sends cookies for authentication. It then redirects to a cross-origin CDN that returns `Access-Control-Allow-Origin: *`. Using `"include"` would fail because the browser requires `Access-Control-Allow-Credentials: true` with a non-wildcard ACAO when credentials are included. This must be preserved in `content-script.js`.

### 7.2 Content Script vs. Background Fetch

Image fetching **must** happen in the content script, not the background service worker. The content script runs in the page's origin (`labs.google`), so `same-origin` credential mode correctly sends the session cookies for the initial media request. The background service worker runs in the extension's origin and would not have the page's cookies.

### 7.3 Blob URL Lifetime

The content script creates the blob URL with `URL.createObjectURL`. This URL is scoped to the content script's document (the Flow page). The background can pass this blob URL to `chrome.downloads.download`, which can access it because the download is initiated from the extension context but the URL is still valid as long as the page hasn't navigated away. The content script should revoke the blob URL only after receiving confirmation that the download has started.

### 7.4 Side Panel API

The `chrome.sidePanel` API (Chrome 114+) is used instead of the deprecated sidebar or a popup. Key API calls:

- `chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true/false })` — enable/disable per tab.
- `chrome.sidePanel.open({ tabId })` — programmatically open (requires user gesture, which the action click provides).
- The manifest's `"side_panel"` key sets the default path.

### 7.5 Save As Dialog

Chrome's `chrome.downloads.download({ saveAs: true })` triggers the native OS file picker, letting the user choose the download location and edit the filename. This is simpler and more reliable than building a custom directory picker in the extension UI. The wizard's Step 2 lets the user pre-set the filename (which becomes the `filename` option in the download call), and `saveAs: true` gives them the final confirmation.

### 7.6 Cancellation

The content script's fetch loop checks an `aborted` flag before starting each new fetch. When `CANCEL` is received, the flag is set to `true`. Any in-flight fetches will complete (we don't abort them mid-flight), but no new fetches will start. The partially-fetched entries are discarded — no partial ZIP is created.

### 7.7 Tab Navigation During Download

If the user navigates away from the Flow page while a download is in progress, the content script is destroyed. The background should detect this via `chrome.tabs.onUpdated` (URL change) and send a `{ type: "DOWNLOAD_ABORTED", reason: "Page navigated away" }` message to the side panel.

---

## 8. Permissions Summary

| Permission | Why |
|---|---|
| `activeTab` | Access the active tab when the user clicks the extension icon |
| `scripting` | Inject the content script programmatically (fallback if declarative injection fails) |
| `downloads` | Trigger `chrome.downloads.download` for the ZIP file with `saveAs: true` |
| `sidePanel` | Use the `chrome.sidePanel` API |
| `tabs` | Listen to `chrome.tabs.onUpdated` for URL-based Flow page detection |

Host permissions remain the same: `https://*.google.com/*` and `https://*.googleusercontent.com/*`.

---

## 9. UX Flow Summary

1. User installs extension. Icon appears gray in toolbar on all pages.
2. User navigates to `https://labs.google/fx/tools/flow/project/...`. The background detects this, swaps the icon to the colored/active variant, and shows a green "✓" badge.
3. User clicks the extension icon. The side panel opens on the right side of the browser (like Claude's panel).
4. **Step 1 — Scan**: Panel shows a description and a "Scan for Images" button. User clicks it. The panel shows a spinner with a live count ("Found 17 images so far...") as the content script scrolls through the page.
5. **Step 2 — Confirm**: Panel shows "Found 42 images". An editable text field shows the default ZIP filename. User can edit it. User clicks "Download ZIP".
6. **Step 3 — Progress**: Panel shows a progress bar filling as images are fetched. Text shows "23 / 42 images fetched". If any fail, a warning line appears.
7. Chrome's native **Save As dialog** appears (from `saveAs: true`), letting the user pick a save location and confirm the filename.
8. **Step 4 — Done**: Panel shows "Done! Downloaded 42 images (12.3 MB)". A "Download Another Project" button resets the wizard.