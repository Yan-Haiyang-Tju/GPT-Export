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

  return false;
});
