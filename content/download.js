// Download flow: scan for image URLs, fetch them with bounded concurrency,
// ZIP the bytes, hand the blob URL back to the service worker for saving.
(() => {
  const FB = (window.__FlowBulk ||= {});
  const { CONCURRENCY } = FB.constants;
  const { makeFilename, findScrollContainer, projectIdFromLocation } = FB.dom;
  const { scrollAndCount } = FB.scan;
  const { buildZip } = FB.zip;

  const state = {
    collectedUrls: [],
    aborted: false,
    scanInProgress: false,
  };

  async function fetchImage(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.arrayBuffer();
  }

  async function handleScan() {
    if (state.scanInProgress) return;
    state.scanInProgress = true;
    state.aborted = false;
    state.collectedUrls = [];
    const projectId = projectIdFromLocation();

    try {
      const container = findScrollContainer();
      if (!container) {
        chrome.runtime.sendMessage({
          type: "SCAN_RESULT",
          count: 0,
          error: "No generated images found",
          projectId,
        });
        return;
      }
      const { urls } = await scrollAndCount(container, ({ images }) => {
        chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", found: images });
      });
      state.collectedUrls = urls;

      chrome.runtime.sendMessage({
        type: "SCAN_RESULT",
        count: urls.length,
        urls,
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
      state.scanInProgress = false;
    }
  }

  async function handleDownload(urls, zipName) {
    state.aborted = false;
    const zipEntries = [];
    let completed = 0;
    let failed = 0;

    async function processOne(url, index) {
      if (state.aborted) return;
      try {
        const data = await fetchImage(url);
        zipEntries.push({ name: makeFilename(url, index), data });
      } catch {
        failed++;
      }
      completed++;
      chrome.runtime.sendMessage({
        type: "DOWNLOAD_PROGRESS",
        completed,
        total: urls.length,
        failed,
      });
    }

    const pool = [];
    for (let i = 0; i < urls.length; i++) {
      if (state.aborted) break;
      const p = processOne(urls[i], i);
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

    if (state.aborted) {
      chrome.runtime.sendMessage({ type: "CANCELLED" });
      return;
    }

    zipEntries.sort((a, b) => a.name.localeCompare(b.name));
    const zipBlob = buildZip(zipEntries);

    // Trigger the save from the page itself: a page-scoped blob URL +
    // <a download> click is the only path that survives both incognito
    // (where blob:chrome-extension:// URLs from the SW don't resolve for
    // chrome.downloads) and large archives (where sending a base64 data
    // URL through chrome.runtime.sendMessage / chrome.downloads.download
    // hits payload-size cliffs and silently fails). The SW only owns the
    // state-machine handoff to "done".
    const blobUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = zipName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

    chrome.runtime.sendMessage({
      type: "ZIP_READY",
      zipName,
      count: zipEntries.length,
      sizeMB: (zipBlob.size / 1024 / 1024).toFixed(1),
    });
  }

  function abort() {
    state.aborted = true;
  }

  function getCollectedUrls() {
    return state.collectedUrls;
  }

  FB.download = { handleScan, handleDownload, abort, getCollectedUrls };
})();
