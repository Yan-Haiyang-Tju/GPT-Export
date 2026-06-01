(function initVault() {
  "use strict";

  const els = {
    clearAll: document.getElementById("clearAll"),
    conversationList: document.getElementById("conversationList"),
    exportAllJson: document.getElementById("exportAllJson"),
    exportAllMarkdown: document.getElementById("exportAllMarkdown"),
    emptyHint: document.getElementById("emptyHint"),
    languageLabel: document.getElementById("languageLabel"),
    localeSelect: document.getElementById("localeSelect"),
    reader: document.getElementById("reader"),
    searchInput: document.getElementById("searchInput"),
    toast: document.getElementById("toast"),
    vaultTitle: document.getElementById("vaultTitle"),
    vaultStats: document.getElementById("vaultStats")
  };

  let conversations = [];
  let selectedId = null;
  let locale = "zh";

  function t(key, values) {
    return ChatBackupI18n.t(locale, key, values);
  }

  function applyLocale() {
    ChatBackupI18n.applyDocumentLocale(locale);
    document.title = `${t("appName")} - ${t("backupLibrary")}`;
    els.vaultTitle.textContent = t("backupLibrary");
    els.languageLabel.textContent = t("language");
    els.localeSelect.value = locale;
    els.exportAllMarkdown.textContent = t("exportAllMarkdown");
    els.exportAllJson.textContent = t("exportAllJson");
    els.clearAll.textContent = t("clearAll");
    els.searchInput.placeholder = t("searchConversations");
    if (els.emptyHint) {
      els.emptyHint.textContent = t("openChatgptStart");
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) {
      return "Unknown";
    }
    return new Date(value).toLocaleString();
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    window.setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  function filteredConversations() {
    const query = els.searchInput.value.trim().toLowerCase();
    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      return [
        conversation.title,
        conversation.status,
        conversation.tags?.join(" ")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }

  function renderList() {
    const items = filteredConversations();

    if (!items.length) {
      els.conversationList.innerHTML = `<div class="empty-state"><p class="small">${escapeHtml(t("noMatchingBackups"))}</p></div>`;
      return;
    }

    els.conversationList.innerHTML = items
      .map((conversation) => {
        const active = conversation.id === selectedId ? " active" : "";
        const star = conversation.favorite ? "★" : "";
        return `
          <button class="conversation-item${active}" data-id="${escapeHtml(conversation.id)}">
            <span class="conversation-title">
              <strong>${escapeHtml(conversation.title || "Untitled conversation")}</strong>
              <span aria-hidden="true">${star}</span>
            </span>
            <span class="conversation-meta">
              <span>${conversation.messageCount || 0} messages</span>
              <span>${escapeHtml(formatDate(conversation.lastBackupAt))}</span>
            </span>
          </button>
        `;
      })
      .join("");
  }

  function renderEmpty() {
    els.reader.innerHTML = `
      <div class="empty-state">
        <div>
          <h2>${escapeHtml(t("noConversationSelected"))}</h2>
          <p class="small">${escapeHtml(t("chooseLocalBackup"))}</p>
        </div>
      </div>
    `;
  }

  function roleLabel(role) {
    if (role === "assistant") {
      return t("assistantRole");
    }
    if (role === "user") {
      return t("userRole");
    }
    return role || t("messageRole");
  }

  async function renderConversation(conversationId) {
    const item = await ChatBackupDB.getConversation(conversationId);

    if (!item.conversation) {
      renderEmpty();
      return;
    }

    selectedId = conversationId;
    renderList();

    const conversation = item.conversation;
    const messages = item.messages || [];
    const messageHtml = messages
      .map((message) => {
        return `
          <article class="message">
            <div class="role">${escapeHtml(roleLabel(message.role))}</div>
            <div class="message-content">${escapeHtml(message.content)}</div>
          </article>
        `;
      })
      .join("");

    els.reader.innerHTML = `
      <div class="reader-inner">
        <section class="conversation-panel">
          <header class="conversation-header">
            <div>
              <h2>${escapeHtml(conversation.title || t("untitled"))}</h2>
              <p class="small muted">
                ${escapeHtml(t("lastBackupLabel"))}: ${escapeHtml(formatDate(conversation.lastBackupAt))} ·
                ${messages.length} ${escapeHtml(t("messages"))} ·
                ${escapeHtml(conversation.status || t("unknown"))}
              </p>
            </div>
            <div class="actions" style="margin-top:0">
              <button id="toggleFavorite" class="icon" title="${escapeHtml(t("favorite"))}" aria-label="${escapeHtml(t("favorite"))}">${conversation.favorite ? "★" : "☆"}</button>
              <button id="exportMarkdown">${escapeHtml(t("markdown"))}</button>
              <button id="exportJson">${escapeHtml(t("json"))}</button>
              <button id="deleteConversation" class="danger">${escapeHtml(t("delete"))}</button>
            </div>
          </header>
          <div class="message-list">${messageHtml || `<p class='small muted'>${escapeHtml(t("noBackupsYet"))}</p>`}</div>
        </section>
      </div>
    `;

    document.getElementById("exportMarkdown").addEventListener("click", () => {
      ChatBackupExport.downloadMarkdown(`${ChatBackupExport.safeFilename(conversation.title)}.md`, item, locale);
    });

    document.getElementById("exportJson").addEventListener("click", () => {
      ChatBackupExport.downloadJson(`${ChatBackupExport.safeFilename(conversation.title)}.json`, item);
    });

    document.getElementById("toggleFavorite").addEventListener("click", async () => {
      await ChatBackupDB.updateConversation(conversation.id, {
        favorite: !conversation.favorite
      });
      await refresh();
      await renderConversation(conversation.id);
    });

    document.getElementById("deleteConversation").addEventListener("click", async () => {
      const confirmed = window.confirm(t("deleteConversationConfirm"));
      if (!confirmed) {
        return;
      }
      await ChatBackupDB.deleteConversation(conversation.id);
      selectedId = null;
      await refresh();
      renderEmpty();
      showToast(t("conversationDeleted"));
    });
  }

  async function refresh() {
    conversations = await ChatBackupDB.listConversations();
    const stats = await ChatBackupDB.getStats();
    els.vaultStats.textContent = t("backupLibraryStats", {
      conversations: stats.conversationCount,
      messages: stats.messageCount
    });
    renderList();
  }

  async function exportAllJson() {
    const data = await ChatBackupDB.getAllData();
    const date = new Date().toISOString().slice(0, 10);
    ChatBackupExport.downloadJson(`chatgpt-backup-${date}.json`, data);
  }

  async function exportAllMarkdown() {
    const data = await ChatBackupDB.getAllData();
    const content = data.conversations
      .map((item) => ChatBackupExport.conversationToMarkdown(item, locale))
      .join("\n---\n\n");
    const date = new Date().toISOString().slice(0, 10);
    ChatBackupExport.downloadText(`chatgpt-backup-${date}.md`, content, "text/markdown;charset=utf-8");
  }

  els.conversationList.addEventListener("click", (event) => {
    const button = event.target.closest(".conversation-item");
    if (!button) {
      return;
    }
    renderConversation(button.dataset.id).catch(() => showToast(t("openFailed")));
  });

  els.searchInput.addEventListener("input", () => {
    renderList();
  });

  els.exportAllJson.addEventListener("click", () => {
    exportAllJson().catch(() => showToast(t("exportFailed")));
  });

  els.exportAllMarkdown.addEventListener("click", () => {
    exportAllMarkdown().catch(() => showToast(t("exportFailed")));
  });

  els.clearAll.addEventListener("click", async () => {
    const confirmed = window.confirm(t("clearAllConfirm"));
    if (!confirmed) {
      return;
    }
    await ChatBackupDB.clearAll();
    selectedId = null;
    await refresh();
    renderEmpty();
    showToast(t("allCleared"));
  });

  els.localeSelect.addEventListener("change", async () => {
    locale = await ChatBackupI18n.setLocale(els.localeSelect.value);
    applyLocale();
    await refresh();
    if (selectedId) {
      await renderConversation(selectedId);
    } else {
      renderEmpty();
    }
  });

  async function init() {
    locale = await ChatBackupI18n.getLocale();
    applyLocale();
    await refresh();
  }

  init().catch(() => showToast(t("loadFailed")));
})();
