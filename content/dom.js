// Flow-specific DOM queries. Everything that knows about `[role="toolbar"]`,
// `img[alt="Generated image"]`, or Flow's "Reuse / Delete" button text lives
// here so the flow-specific brittleness is contained.
(() => {
  const FB = (window.__FlowBulk ||= {});

  // The Flow project list is inside a virtualized scroll container somewhere
  // deep in the tree. Prefer probing from a rendered image (cheap + correct),
  // and fall back to scanning for the tallest scrollable element — the only
  // thing that works when every batch errored out and no `Generated image`
  // exists as a probe anchor.
  function findScrollContainer() {
    const probe =
      document.querySelector('img[alt="Generated image"]') ||
      document.querySelector('img[alt*="media generated"]');
    if (probe) {
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
    }

    let best = null;
    document.querySelectorAll("*").forEach((el) => {
      const s = getComputedStyle(el);
      if (
        el.scrollHeight > el.clientHeight + 20 &&
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        (!best || el.scrollHeight > best.scrollHeight)
      ) {
        best = el;
      }
    });
    return best || document.scrollingElement || document.documentElement;
  }

  function collectImageUrls() {
    const urls = new Set();
    document.querySelectorAll('img[alt="Generated image"]').forEach((img) => {
      if (img.src) urls.add(img.src);
    });
    return [...urls];
  }

  // Image-group toolbars carry a "Reuse Prompt" button; collection toolbars
  // don't. This is the only reliable way to tell them apart.
  function toolbarHasReuse(toolbar) {
    return [...toolbar.querySelectorAll("button")].some((b) =>
      b.textContent.includes("Reuse")
    );
  }

  // endsWith("Delete") avoids matching buttons whose textContent contains
  // "Delete" non-terminally (e.g. a future "Delete & archive" action).
  function findImageGroupDeleteButtons() {
    const out = [];
    document.querySelectorAll('[role="toolbar"]').forEach((tb) => {
      if (!toolbarHasReuse(tb)) return;
      const btn = [...tb.querySelectorAll("button")].find((b) =>
        b.textContent.trim().endsWith("Delete")
      );
      if (btn) out.push(btn);
    });
    return out;
  }

  function findAllDeleteButtons() {
    const out = [];
    document.querySelectorAll('[role="toolbar"]').forEach((tb) => {
      const btn = [...tb.querySelectorAll("button")].find((b) =>
        b.textContent.trim().endsWith("Delete")
      );
      if (btn) out.push(btn);
    });
    return out;
  }

  // Content-derived stable identifier for a batch. Used both for accurate
  // count dedupe across virtualized scroll (a Set of keys converges on the
  // true total) and for stuck-detection — if the same key still exists in
  // the DOM after we tried to delete it, the batch didn't go away.
  //
  // Strategy: walk up from the toolbar to the smallest ancestor that holds
  // exactly one toolbar, take the first `Generated image` src from it. For
  // errored batches with no images, fall back to the prompt text snippet.
  function batchKey(toolbar) {
    if (!toolbar) return null;
    let el = toolbar.parentElement;
    let depth = 0;
    while (el && depth < 8 && el !== document.body) {
      // Multiple toolbars under this ancestor means we've walked too far.
      if (el.querySelectorAll('[role="toolbar"]').length > 1) break;
      const img = el.querySelector('img[alt="Generated image"]');
      if (img?.src) return img.src;
      el = el.parentElement;
      depth++;
    }
    // No image — likely an errored-only batch. Use the prompt text.
    const tight = toolbar.parentElement;
    if (tight) {
      const text = tight.textContent.trim().replace(/\s+/g, " ").slice(0, 120);
      if (text) return `t:${text}`;
    }
    return null;
  }

  // Short, human-readable label for a batch key. Used in the UI to show
  // which batch is currently being processed.
  function batchLabel(key) {
    if (!key) return "?";
    if (key.startsWith("t:")) {
      const txt = key.slice(2);
      return `"${txt.slice(0, 28)}${txt.length > 28 ? "…" : ""}"`;
    }
    try {
      const id = new URL(key).searchParams.get("name") || "";
      const short = id.split("-")[0]?.slice(0, 8);
      if (short) return short;
    } catch {}
    return key.slice(0, 12);
  }

  function collectVisibleBatchKeys() {
    const keys = [];
    document.querySelectorAll('[role="toolbar"]').forEach((tb) => {
      if (!toolbarHasReuse(tb)) return;
      const key = batchKey(tb);
      if (key) keys.push(key);
    });
    return keys;
  }

  // Does any toolbar in the current DOM resolve to this key? Used to detect
  // stuck batches (we tried to delete it but it's still here).
  function batchExistsByKey(key) {
    if (!key) return false;
    for (const tb of document.querySelectorAll('[role="toolbar"]')) {
      if (batchKey(tb) === key) return true;
    }
    return false;
  }

  // The dialog "Delete" is the one NOT inside a toolbar — the toolbar's own
  // Delete button opens it.
  function findConfirmDeleteButton() {
    for (const b of document.querySelectorAll("button")) {
      if (
        b.textContent.trim() === "Delete" &&
        !b.closest('[role="toolbar"]')
      ) {
        return b;
      }
    }
    return null;
  }

  function clickAllCancelButtons() {
    document.querySelectorAll("button").forEach((b) => {
      if (b.textContent.trim() === "Cancel") b.click();
    });
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

  function projectIdFromLocation() {
    return (
      location.pathname.match(/project\/([^/]+)/)?.[1]?.slice(0, 8) || "flow"
    );
  }

  FB.dom = {
    findScrollContainer,
    collectImageUrls,
    toolbarHasReuse,
    findImageGroupDeleteButtons,
    findAllDeleteButtons,
    batchKey,
    batchLabel,
    collectVisibleBatchKeys,
    batchExistsByKey,
    findConfirmDeleteButton,
    clickAllCancelButtons,
    makeFilename,
    projectIdFromLocation,
  };
})();
