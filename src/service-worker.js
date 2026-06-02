importScripts("db.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "BACKUP_SNAPSHOT") {
    ChatBackupDB.saveSnapshot(message.snapshot)
      .then(async (result) => {
        await chrome.storage.local.set({
          lastBackupResult: {
            ...result,
            tabId: sender.tab?.id || null,
            url: sender.tab?.url || ""
          }
        });
        sendResponse({
          ok: true,
          result
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || String(error)
        });
      });
    return true;
  }

  if (message.type === "GET_STATS") {
    ChatBackupDB.getStats()
      .then((stats) => sendResponse({ ok: true, stats }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message.type === "FETCH_ATTACHMENT_DATA_URL") {
    fetchAttachmentDataUrl(message.url, message.maxBytes)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  return false;
});

async function fetchAttachmentDataUrl(url, maxBytes) {
  if (!url || typeof url !== "string") {
    throw new Error("Missing attachment URL.");
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Unsupported attachment URL protocol.");
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Attachment request failed: ${response.status}`);
  }

  const blob = await response.blob();
  const limit = Number.isFinite(maxBytes) ? maxBytes : 8 * 1024 * 1024;
  if (blob.size > limit) {
    return {
      dataUrl: "",
      mimeType: blob.type || "",
      size: blob.size,
      captureStatus: "too_large"
    };
  }

  const dataUrl = await blobToDataUrl(blob);

  return {
    dataUrl,
    mimeType: blob.type || "",
    size: blob.size,
    captureStatus: "saved"
  };
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}
