# Flow Image Bulk Downloader (minimal)

A minimal Chrome extension that scans the current tab (intended for Google Flow project pages) and downloads all discovered image URLs.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.

## Use

1. Open your Google Flow project page.
2. Click the extension icon.
3. Click **Download page images**.

## What it grabs

- `<img src="...">` sources
- Inline `style="background-image: url(...)"` images

## Notes

- This is intentionally the simplest possible version.
- It starts one Chrome download per discovered image URL.
