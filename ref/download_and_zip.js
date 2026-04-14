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

  // ─── Configuration ──────────────────────────────────────────────
  /** @type {number} ms to wait after each scroll for lazy images to load */
  const SCROLL_PAUSE = 600;
  /** @type {number} px to scroll each step */
  const SCROLL_STEP = 800;
  /** @type {number} max fetch concurrency */
  const CONCURRENCY = 4;

  // ─── Utilities ──────────────────────────────────────────────────
  /** @param {number} ms */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Find the scrollable ancestor that contains the image grid.
   * Walks up from the first generated image until it finds an
   * element with overflow-y: auto|scroll.
   * @returns {HTMLElement|null}
   */
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
    // fallback: the page itself scrolls
    return document.documentElement;
  }

  /**
   * Collect every unique generated-image URL currently in the DOM.
   * @returns {string[]}
   */
  function collectImageUrls() {
    /** @type {Set<string>} */
    const urls = new Set();
    document.querySelectorAll('img[alt="Generated image"]').forEach((img) => {
      if (img.src) urls.add(img.src);
    });
    return [...urls];
  }

  /**
   * Extract a short filename from a Flow image URL.
   * The URL contains ?name=<uuid> — we use the first 8 chars of the UUID.
   * @param {string} url
   * @param {number} index
   * @returns {string}
   */
  function makeFilename(url, index) {
    try {
      const id = new URL(url).searchParams.get("name") || "";
      const short = id.split("-")[0] || String(index);
      return `flow_${String(index + 1).padStart(3, "0")}_${short}.jpg`;
    } catch {
      return `flow_${String(index + 1).padStart(3, "0")}.jpg`;
    }
  }

  /**
   * Fetch an image as an ArrayBuffer.
   *
   * NOTE: uses "same-origin" credentials (not "include") because the
   * media endpoint redirects to a cross-origin CDN. With "include",
   * the browser requires Access-Control-Allow-Credentials: true and a
   * non-wildcard ACAO header — the CDN sends a wildcard, causing a
   * CORS error. "same-origin" sends cookies for the initial same-origin
   * request (which authenticates the redirect URL) but omits them for
   * the cross-origin redirect target, satisfying CORS.
   *
   * @param {string} url
   * @returns {Promise<ArrayBuffer>}
   */
  async function fetchImage(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.arrayBuffer();
  }

  // ─── Minimal ZIP builder (no library) ──────────────────────────
  //
  // Implements the bare-minimum ZIP spec (store-only, no compression)
  // per PKZIP APPNOTE 6.3.x §4.3.  Each file is stored uncompressed
  // which keeps the code tiny and fast.

  /**
   * @typedef {Object} ZipEntry
   * @property {string}      name   - filename (ASCII safe)
   * @property {ArrayBuffer} data   - raw file bytes
   */

  /**
   * Build a ZIP file from an array of entries (store method, no compression).
   * @param {ZipEntry[]} entries
   * @returns {Blob}
   */
  function buildZip(entries) {
    /**
     * Write a 16-bit unsigned little-endian value into a DataView.
     * @param {DataView} view
     * @param {number}   offset
     * @param {number}   value
     */
    const w16 = (view, offset, value) => view.setUint16(offset, value, true);

    /**
     * Write a 32-bit unsigned little-endian value into a DataView.
     * @param {DataView} view
     * @param {number}   offset
     * @param {number}   value
     */
    const w32 = (view, offset, value) => view.setUint32(offset, value, true);

    /**
     * Compute CRC-32 for a Uint8Array (standard CRC-32/ISO 3309).
     * @param {Uint8Array} buf
     * @returns {number}
     */
    function crc32(buf) {
      /** @type {number[]} */
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
    /** @type {{ localOffset: number; nameBytes: Uint8Array; crc: number; size: number }[]} */
    const meta = [];
    /** @type {ArrayBuffer[]} */
    const parts = [];
    let offset = 0;

    // ── Local file headers + file data ──
    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const fileData = new Uint8Array(entry.data);
      const crc = crc32(fileData);

      // Local file header: 30 bytes fixed + name length
      const header = new ArrayBuffer(30 + nameBytes.length);
      const hv = new DataView(header);
      w32(hv, 0, 0x04034b50);       // local file header signature
      w16(hv, 4, 20);                // version needed to extract (2.0)
      w16(hv, 6, 0);                 // general purpose bit flag
      w16(hv, 8, 0);                 // compression method: stored
      w16(hv, 10, 0);                // last mod file time
      w16(hv, 12, 0);                // last mod file date
      w32(hv, 14, crc);              // crc-32
      w32(hv, 18, fileData.length);  // compressed size
      w32(hv, 22, fileData.length);  // uncompressed size
      w16(hv, 26, nameBytes.length); // file name length
      w16(hv, 28, 0);                // extra field length
      new Uint8Array(header).set(nameBytes, 30);

      meta.push({ localOffset: offset, nameBytes, crc, size: fileData.length });
      parts.push(header, fileData.buffer);
      offset += header.byteLength + fileData.length;
    }

    // ── Central directory ──
    const cdStart = offset;
    for (const m of meta) {
      const cd = new ArrayBuffer(46 + m.nameBytes.length);
      const cv = new DataView(cd);
      w32(cv, 0, 0x02014b50);       // central directory file header signature
      w16(cv, 4, 20);                // version made by
      w16(cv, 6, 20);                // version needed to extract
      w16(cv, 8, 0);                 // general purpose bit flag
      w16(cv, 10, 0);                // compression method: stored
      w16(cv, 12, 0);                // last mod file time
      w16(cv, 14, 0);                // last mod file date
      w32(cv, 16, m.crc);            // crc-32
      w32(cv, 20, m.size);           // compressed size
      w32(cv, 24, m.size);           // uncompressed size
      w16(cv, 28, m.nameBytes.length); // file name length
      w16(cv, 30, 0);                // extra field length
      w16(cv, 32, 0);                // file comment length
      w16(cv, 34, 0);                // disk number start
      w16(cv, 36, 0);                // internal file attributes
      w32(cv, 38, 0);                // external file attributes
      w32(cv, 42, m.localOffset);    // relative offset of local header
      new Uint8Array(cd).set(m.nameBytes, 46);
      parts.push(cd);
      offset += cd.byteLength;
    }

    const cdSize = offset - cdStart;

    // ── End of central directory ──
    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    w32(ev, 0, 0x06054b50);          // end of central dir signature
    w16(ev, 4, 0);                    // number of this disk
    w16(ev, 6, 0);                    // disk where central directory starts
    w16(ev, 8, entries.length);       // number of central directory records on this disk
    w16(ev, 10, entries.length);      // total number of central directory records
    w32(ev, 12, cdSize);              // size of central directory
    w32(ev, 16, cdStart);             // offset of start of central directory
    w16(ev, 20, 0);                   // comment length
    parts.push(eocd);

    return new Blob(parts, { type: "application/zip" });
  }

  // ─── Progress logging ───────────────────────────────────────────
  /**
   * Simple styled console logger.
   * @param {string} msg
   */
  function log(msg) {
    console.log(
      `%c[FlowDL]%c ${msg}`,
      "color:#facc15;font-weight:bold",
      "color:inherit"
    );
  }

  // ─── Main flow ──────────────────────────────────────────────────
  log("Starting bulk download…");

  // 1. Find scrollable container
  const container = findScrollContainer();
  if (!container) {
    log("❌ No generated images found on this page. Are you on a Flow project?");
    return;
  }

  log("Found scroll container.");

  // 2. Scroll from top to bottom, collecting URLs along the way
  log("Scrolling to load all images…");
  /** @type {Set<string>} */
  const allUrls = new Set();
  container.scrollTop = 0;
  await sleep(SCROLL_PAUSE);

  while (true) {
    // Collect whatever is currently rendered
    collectImageUrls().forEach((u) => allUrls.add(u));

    const before = container.scrollTop;
    container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
    await sleep(SCROLL_PAUSE);

    // If scroll position didn't change, we've reached the bottom
    if (container.scrollTop === before) break;
  }

  // One final collection at the bottom
  collectImageUrls().forEach((u) => allUrls.add(u));

  const urls = [...allUrls];
  log(`Discovered ${urls.length} unique image(s).`);

  if (urls.length === 0) {
    log("❌ No images to download.");
    return;
  }

  // 3. Fetch all images (with bounded concurrency)
  log(`Fetching images (concurrency: ${CONCURRENCY})…`);

  /** @type {ZipEntry[]} */
  const zipEntries = [];
  let completed = 0;

  /**
   * Process a batch item: fetch and push to zipEntries.
   * @param {string} url
   * @param {number} index
   */
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

  // Simple concurrency pool
  /** @type {Promise<void>[]} */
  const pool = [];
  for (let i = 0; i < urls.length; i++) {
    const p = process(urls[i], i);
    pool.push(p);
    if (pool.length >= CONCURRENCY) {
      await Promise.race(pool);
      // Remove settled promises
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

  // 4. Sort entries by name so they're in order
  zipEntries.sort((a, b) => a.name.localeCompare(b.name));

  // 5. Build ZIP and trigger download
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