// Module-local state shared between render, commands, and subscriptions.
// Kept in one small module so we don't have to pass mutable state objects
// through every function signature.

let activeTabId = null;
let zipNameDirty = false;
let lastState = null;
let lastDeletePhase = null;

export function getActiveTabId() {
  return activeTabId;
}
export function setActiveTabId(v) {
  activeTabId = v;
}

export function isZipNameDirty() {
  return zipNameDirty;
}
export function setZipNameDirty(v) {
  zipNameDirty = v;
}

export function getLastState() {
  return lastState;
}
export function getLastDeletePhase() {
  return lastDeletePhase;
}
export function trackRender(state) {
  lastDeletePhase = lastState?.deletePhase || null;
  lastState = state;
}
