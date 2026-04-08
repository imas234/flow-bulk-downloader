const status = document.getElementById("status");

document.getElementById("download").addEventListener("click", async () => {
  status.textContent = "Scanning current tab...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    status.textContent = "No active tab found.";
    return;
  }

  const [{ result: urls = [] } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const all = new Set();

      document.querySelectorAll("img[src]").forEach((img) => {
        if (img.src) all.add(img.src);
      });

      document.querySelectorAll("[style]").forEach((el) => {
        const m = el.style.backgroundImage?.match(/url\(["']?(.*?)["']?\)/i);
        if (m?.[1]) {
          const absolute = new URL(m[1], location.href).href;
          all.add(absolute);
        }
      });

      return Array.from(all);
    }
  });

  if (!urls.length) {
    status.textContent = "No images found.";
    return;
  }

  status.textContent = `Downloading ${urls.length} images...`;
  for (const url of urls) {
    chrome.downloads.download({
      url,
      conflictAction: "uniquify",
      saveAs: false
    });
  }

  status.textContent = `Started ${urls.length} downloads.`;
});
