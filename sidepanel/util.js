// Pure formatting helpers. No DOM, no state — just string math.

export function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural || singular + "s"}`;
}

// Batch count is a max-seen lower bound from the scroll pass; it can be 0
// when the list is virtualized and the toolbars never co-rendered. The
// phrasing here is deliberately vague about that because surfacing the
// caveat in UI copy is noisier than it's worth.
export function describeScanCounts(images, batches, opts = {}) {
  if (opts.bugged && batches > 0) {
    return `${pluralize(batches, "batch", "batches")} (images failed to load)`;
  }
  if (images > 0 && batches > 0) {
    return `${pluralize(images, "image")} across ${pluralize(batches, "batch", "batches")}`;
  }
  if (images > 0) return pluralize(images, "image");
  if (batches > 0) {
    return `${pluralize(batches, "errored batch", "errored batches")} (no generated images)`;
  }
  return "0 images";
}

export function dateStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function defaultZipName(projectId) {
  return `flow_${(projectId || "flow").slice(0, 8)}_${dateStamp()}.zip`;
}
