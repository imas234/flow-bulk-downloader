# Flow Image Bulk Downloader

Chrome extension for Google Flow project pages that discovers all generated images (including lazy-loaded content), builds a ZIP client-side, and downloads a single archive via a wizard-style side panel.

## What's new in v0.2.0

- Replaced popup UI with a 4-step side panel wizard.
- Added automatic Flow page detection with active/inactive toolbar icons and badge state.
- Added content-script scan logic that scrolls the Flow container to discover lazy-loaded `img[alt="Generated image"]` items.
- Added bounded-concurrency image fetching and client-side ZIP assembly.
- Added cancellation support and progress reporting for scan and download phases.
- Added a reference console implementation in `ref/` for parity documentation.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository directory.

## Usage

1. Navigate to a Flow project URL like:
   `https://labs.google/fx/tools/flow/project/<project-id>`
2. Click the extension action icon (it shows a green ✓ badge on supported pages).
3. In the side panel, click **Scan for Images**.
4. Confirm image count and optional ZIP filename.
5. Click **Download ZIP**.
6. In Chrome's native **Save As** dialog, confirm destination and filename.

## Architecture

- `background.js`: service worker for Flow URL detection, icon/badge updates, side-panel enablement, message relay, and `chrome.downloads.download` invocation.
- `content-script.js`: Flow page scanner, image fetcher (`credentials: "same-origin"`), ZIP builder, cancellation flag handling.
- `sidepanel.html/js/css`: wizard UI and runtime messaging.
- `ref/`: documentation-only console scripts mirroring core logic.

## Permissions

- `activeTab`: interact with current tab when user clicks the action.
- `scripting`: retained as fallback support.
- `downloads`: trigger native Save As ZIP download.
- `sidePanel`: open/configure side panel.
- `tabs`: detect tab URL changes and per-tab enablement.

Host permissions:

- `https://*.google.com/*`
- `https://*.googleusercontent.com/*`
