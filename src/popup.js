(function initPopup() {
  "use strict";

  const els = {
    autoBackupLabel: document.getElementById("autoBackupLabel"),
    conversationLabel: document.getElementById("conversationLabel"),
    conversationCount: document.getElementById("conversationCount"),
    currentPageHeading: document.getElementById("currentPageHeading"),
    exportAllJson: document.getElementById("exportAllJson"),
    exportCurrent: document.getElementById("exportCurrent"),
    languageLabel: document.getElementById("languageLabel"),
    localeSelect: document.getElementById("localeSelect"),
    lastBackup: document.getElementById("lastBackup"),
    lastBackupHeading: document.getElementById("lastBackupHeading"),
    messageLabel: document.getElementById("messageLabel"),
    messageCount: document.getElementById("messageCount"),
    openVault: document.getElementById("openVault"),
    backupEnabled: document.getElementById("backupEnabled"),
    pageStatus: document.getElementById("pageStatus"),
    pageTitle: document.getElementById("pageTitle"),
    popupSubtitle: document.getElementById("popupSubtitle"),
    popupTitle: document.getElementById("popupTitle"),
    saveNow: document.getElementById("saveNow")
  };

  let activeTab = null;
  let pageSnapshot = null;
  let locale = "zh";

  function t(key, values) {
    return ChatBackupI18n.t(locale, key, values);
  }

  function applyLocale() {
    ChatBackupI18n.applyDocumentLocale(locale);
    els.popupTitle.textContent = t("appShortName");
    els.popupSubtitle.textContent = t("chatgptConversations");
    els.languageLabel.textContent = t("language");
    els.currentPageHeading.textContent = t("currentPage");
    els.autoBackupLabel.textContent = t("autoBackupLabel");
    els.saveNow.textContent = t("saveNow");
    els.exportCurrent.textContent = t("exportCurrent");
    els.conversationLabel.textContent = t("conversations");
    els.messageLabel.textContent = t("messages");
    els.lastBackupHeading.textContent = t("lastBackup");
    els.exportAllJson.textContent = t("exportAllJson");
    els.openVault.title = t("openBackupLibrary");
    els.openVault.setAttribute("aria-label", t("openBackupLibrary"));
    els.localeSelect.value = locale;
  }

  function formatDate(value) {
    if (!value) {
      return "Never";
    }
    return new Date(value).toLocaleString();
  }

  function setStatus(text, tone) {
    els.pageStatus.textContent = text;
    els.pageStatus.className = `pill ${tone || ""}`.trim();
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    return tabs[0] || null;
  }

  async function askCurrentPage(message) {
    if (!activeTab?.id) {
      return null;
    }

    try {
      return await chrome.tabs.sendMessage(activeTab.id, message);
    } catch {
      return null;
    }
  }

  async function loadStats() {
    const stats = await ChatBackupDB.getStats();
    els.conversationCount.textContent = String(stats.conversationCount);
    els.messageCount.textContent = String(stats.messageCount);
    els.lastBackup.textContent = stats.latestBackupAt
      ? formatDate(stats.latestBackupAt)
      : t("noBackupsYet");
  }

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      backupEnabled: true,
      locale: "zh"
    });
    els.backupEnabled.checked = Boolean(settings.backupEnabled);
    locale = ChatBackupI18n.normalizeLocale(settings.locale);
    applyLocale();
  }

  async function loadPageStatus() {
    activeTab = await getActiveTab();
    const response = await askCurrentPage({
      type: "GET_PAGE_STATUS"
    });

    if (!response?.ok || !response.supported) {
      setStatus(t("inactive"), "warn");
      els.pageTitle.textContent = t("openChatgptToBackup");
      els.saveNow.disabled = true;
      els.exportCurrent.disabled = true;
      return;
    }

    pageSnapshot = response.snapshot;
    const messageCount = pageSnapshot?.messages?.length || 0;
    const title = pageSnapshot?.conversation?.title || "Conversation detected";

    setStatus(messageCount ? t("ready") : t("watching"), "");
    els.pageTitle.textContent = t("detectedMessages", {
      title,
      count: messageCount
    });
    els.saveNow.disabled = false;
    els.exportCurrent.disabled = !messageCount;
  }

  async function forceSave() {
    els.saveNow.disabled = true;
    els.saveNow.textContent = t("saving");
    const response = await askCurrentPage({
      type: "FORCE_BACKUP"
    });

    if (!response?.ok) {
      setStatus(t("failed"), "error");
    } else {
      pageSnapshot = response.snapshot;
      setStatus(t("saved"), "");
    }

    els.saveNow.textContent = t("saveNow");
    els.saveNow.disabled = false;
    await loadStats();
  }

  async function exportCurrent() {
    if (!pageSnapshot?.conversation?.id) {
      await forceSave();
    }

    const id = pageSnapshot?.conversation?.id;
    if (!id) {
      return;
    }

    const item = await ChatBackupDB.getConversation(id);
    if (!item.conversation) {
      return;
    }

    const filename = `${ChatBackupExport.safeFilename(item.conversation.title)}.md`;
    ChatBackupExport.downloadMarkdown(filename, item, locale);
  }

  async function exportAllJson() {
    const data = await ChatBackupDB.getAllData();
    const date = new Date().toISOString().slice(0, 10);
    ChatBackupExport.downloadJson(`chatgpt-backup-${date}.json`, data);
  }

  els.openVault.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  els.backupEnabled.addEventListener("change", async () => {
    await chrome.storage.local.set({
      backupEnabled: els.backupEnabled.checked
    });
    setStatus(els.backupEnabled.checked ? t("ready") : t("paused"), els.backupEnabled.checked ? "" : "warn");
  });

  els.localeSelect.addEventListener("change", async () => {
    locale = await ChatBackupI18n.setLocale(els.localeSelect.value);
    applyLocale();
    await loadStats();
    await loadPageStatus();
  });

  els.saveNow.addEventListener("click", () => {
    forceSave().catch(() => setStatus("Failed", "error"));
  });

  els.exportCurrent.addEventListener("click", () => {
    exportCurrent().catch(() => setStatus(t("failed"), "error"));
  });

  els.exportAllJson.addEventListener("click", () => {
    exportAllJson().catch(() => setStatus(t("failed"), "error"));
  });

  async function init() {
    await loadSettings();
    await Promise.all([loadStats(), loadPageStatus()]);
  }

  init().catch(() => {
    setStatus(t("failed"), "error");
  });
})();
