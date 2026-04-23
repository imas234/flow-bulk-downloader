// Guard against double-initialization. The background service worker may
// programmatically inject this script (via chrome.scripting.executeScript)
// when the user SPA-navigates into a Flow project from a non-matching URL —
// in that case the manifest's declarative injection didn't fire. But if the
// manifest DID inject and we get injected a second time anyway, we must not
// register duplicate listeners or wipe in-flight state.
if (window.__flowBulkDownloaderLoaded) {
  // Already initialized on this document — do nothing on re-inject.
} else {
  window.__flowBulkDownloaderLoaded = true;

  const SCROLL_PAUSE = 600;
  const SCROLL_STEP = 800;
  const CONCURRENCY = 4;

  let collectedUrls = [];
  let aborted = false;
  let scanInProgress = false;

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

async function handleScan() {
  if (scanInProgress) return;

  scanInProgress = true;
  aborted = false;
  collectedUrls = [];
  const projectId = location.pathname.match(/project\/([^/]+)/)?.[1]?.slice(0, 8) || "flow";

  try {
    const container = findScrollContainer();
    if (!container) {
      chrome.runtime.sendMessage({ type: "SCAN_RESULT", count: 0, error: "No generated images found", projectId });
      return;
    }

    const allUrls = new Set();
    container.scrollTop = 0;
    await sleep(SCROLL_PAUSE);

    while (true) {
      collectImageUrls().forEach((u) => allUrls.add(u));
      chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", found: allUrls.size });
      const before = container.scrollTop;
      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
      await sleep(SCROLL_PAUSE);
      if (container.scrollTop === before) break;
    }

    collectImageUrls().forEach((u) => allUrls.add(u));
    collectedUrls = [...allUrls];

    chrome.runtime.sendMessage({
      type: "SCAN_RESULT",
      count: collectedUrls.length,
      urls: collectedUrls,
      projectId,
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: "SCAN_RESULT",
      count: 0,
      error: error.message || "Scan failed",
      projectId,
    });
  } finally {
    scanInProgress = false;
  }
}

async function handleDownload(urls, zipName) {
  aborted = false;
  const zipEntries = [];
  let completed = 0;
  let failed = 0;

  async function process(url, index) {
    if (aborted) return;
    try {
      const data = await fetchImage(url);
      zipEntries.push({ name: makeFilename(url, index), data });
    } catch {
      failed++;
    }
    completed++;
    chrome.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", completed, total: urls.length, failed });
  }

  const pool = [];
  for (let i = 0; i < urls.length; i++) {
    if (aborted) break;
    const p = process(urls[i], i);
    pool.push(p);
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool);
      for (let j = pool.length - 1; j >= 0; j--) {
        const settled = await Promise.race([pool[j].then(() => true), Promise.resolve(false)]);
        if (settled) pool.splice(j, 1);
      }
    }
  }

  await Promise.all(pool);

  if (aborted) {
    chrome.runtime.sendMessage({ type: "CANCELLED" });
    return;
  }

  zipEntries.sort((a, b) => a.name.localeCompare(b.name));
  const zipBlob = buildZip(zipEntries);
  const blobUrl = URL.createObjectURL(zipBlob);
  chrome.runtime.sendMessage({
    type: "ZIP_READY",
    blobUrl,
    zipName,
    sizeMB: (zipBlob.size / 1024 / 1024).toFixed(1),
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SCAN") {
    handleScan();
  }

  if (message?.type === "DOWNLOAD") {
    handleDownload(message.urls || collectedUrls, message.zipName || "flow_download.zip");
  }

  if (message?.type === "CANCEL") {
    aborted = true;
    chrome.runtime.sendMessage({ type: "CANCELLED" });
  }

  if (message?.type === "REVOKE_BLOB" && message.blobUrl) {
    URL.revokeObjectURL(message.blobUrl);
  }
});

} // end of double-initialization guard
