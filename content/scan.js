// Shared scroll-and-count used by the download scan, the delete scan, and the
// post-delete verify. Returns the unique image URL count and the unique
// batch-key count. Both use Set dedupe across the entire scroll pass — every
// virtualized mount of every batch contributes to the same Set, so the final
// count converges on the true total instead of the previous "max-seen
// toolbars at any single scroll position" lower bound.
//
// `onProgress({ images, batches, urls })` is called after each scroll step so
// callers can emit whichever message shape they want without this module
// having to know about SCAN_PROGRESS / DELETE_SCAN_PROGRESS specifically.
(() => {
  const FB = (window.__FlowBulk ||= {});
  const { SCROLL_PAUSE, SCROLL_STEP } = FB.constants;
  const { sleep } = FB;
  const { collectVisibleBatchKeys, collectVisibleBuggedBatchKeys } = FB.dom;

  async function scrollAndCount(container, onProgress) {
    const urls = new Set();
    const keys = new Set();
    const buggedKeys = new Set();
    container.scrollTop = 0;
    await sleep(SCROLL_PAUSE);

    const collect = () => {
      document.querySelectorAll('img[alt="Generated image"]').forEach((img) => {
        if (img.src) urls.add(img.src);
      });
      for (const k of collectVisibleBatchKeys()) keys.add(k);
      for (const k of collectVisibleBuggedBatchKeys()) buggedKeys.add(k);
    };

    const snapshot = () => {
      // A project is "bugged" when there are bugged delete triggers but no
      // images loaded — the toolbars that normally identify batches never
      // render. We surface bugged batches in the regular batch count so the
      // existing UI shows non-zero progress, and expose the flag so the
      // panel can hint at the fallback strategy.
      const bugged = buggedKeys.size > 0 && urls.size === 0;
      return {
        images: urls.size,
        batches: keys.size + buggedKeys.size,
        buggedBatches: buggedKeys.size,
        bugged,
      };
    };

    while (true) {
      collect();
      onProgress?.(snapshot());
      const before = container.scrollTop;
      container.scrollBy({ top: SCROLL_STEP, behavior: "instant" });
      await sleep(SCROLL_PAUSE);
      if (container.scrollTop === before) break;
    }

    collect();
    const result = { ...snapshot(), urls: [...urls] };
    onProgress?.(result);
    return result;
  }

  FB.scan = { scrollAndCount };
})();
