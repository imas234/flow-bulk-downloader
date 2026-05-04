// Converts a Blob to a base64 dataURL for chrome.downloads API compatibility.
// Data URLs work in incognito mode unlike blob:chrome-extension:// URLs.
(() => {
  const FB = (window.__FlowBulk ||= {});

  async function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to convert blob to dataURL"));
      reader.readAsDataURL(blob);
    });
  }

  FB.blobToDataURL = { blobToDataURL };
})();
