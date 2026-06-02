(function attachBackupI18n(global) {
  "use strict";

  const DEFAULT_LOCALE = "zh";

  const messages = {
    zh: {
      appName: "ChatGPT 本地备份",
      appShortName: "本地备份",
      backupLibrary: "备份库",
      backupLibraryLoading: "正在加载本地备份",
      backupLibraryStats: "{conversations} 个会话 · {messages} 条消息 · 仅本地保存",
      chatgptConversations: "ChatGPT 会话",
      currentPage: "当前页面",
      checking: "检查中",
      inactive: "未启用",
      ready: "就绪",
      watching: "监听中",
      paused: "已暂停",
      failed: "失败",
      saved: "已保存",
      openChatgptHint: "打开 ChatGPT 会话即可开始备份。",
      openChatgptToBackup: "打开 chatgpt.com 或 chat.openai.com，备份当前可见会话。",
      detectedMessages: "{title} · 已识别 {count} 条消息",
      autoBackupLabel: "自动备份当前可见的 ChatGPT 会话",
      uploadBackupLabel: "备份我上传的文件内容",
      uploadBackupHint: "默认关闭。开启后，插件会在你选择上传文件时保存文件内容，单个文件上限 50MB。",
      saveNow: "立即保存",
      saving: "保存中",
      exportCurrent: "导出当前",
      conversations: "会话",
      messages: "消息",
      attachments: "附件",
      lastBackup: "最近备份",
      noBackupsYet: "还没有本地备份。",
      exportAllJson: "导出全部 JSON",
      exportAllMarkdown: "导出全部 Markdown",
      clearAll: "清空全部",
      searchConversations: "搜索会话",
      noConversationSelected: "未选择会话",
      openChatgptStart: "打开 ChatGPT 并开始聊天，本地备份会出现在这里。",
      chooseLocalBackup: "从左侧选择一个本地备份。",
      noMatchingBackups: "没有匹配的备份。",
      source: "来源",
      lastBackupLabel: "最近备份",
      status: "状态",
      unknown: "未知",
      favorite: "收藏",
      markdown: "Markdown",
      json: "JSON",
      download: "下载",
      metadataOnly: "仅元信息",
      savedLocally: "已保存本地副本",
      attachmentList: "附件",
      delete: "删除",
      deleteConversationConfirm: "删除这个本地备份？这不会删除 ChatGPT 里的任何内容。",
      conversationDeleted: "会话已删除。",
      clearAllConfirm: "清空当前浏览器配置里的所有本地备份？",
      allCleared: "所有本地备份已清空。",
      exportFailed: "导出失败。",
      openFailed: "无法打开会话。",
      loadFailed: "无法加载本地备份。",
      userRole: "用户",
      assistantRole: "助手",
      messageRole: "消息",
      untitled: "未命名会话",
      localOnly: "仅本地保存",
      openBackupLibrary: "打开备份库",
      language: "语言",
      chinese: "中文",
      english: "English",
      badgeWatching: "备份：监听中",
      badgePaused: "备份：已暂停",
      badgeNoMessages: "备份：未找到消息",
      badgeSavingDraft: "备份：正在保存草稿",
      badgeSaving: "备份：保存中",
      badgeFailedUnavailable: "备份失败：扩展不可用",
      badgeFailed: "备份失败",
      badgeSavedMessages: "备份：已保存 {count} 条消息",
      badgeSavedWithAttachments: "备份：已保存 {messages} 条消息，{attachments} 个附件",
      markdownSource: "来源",
      markdownLastBackup: "最近备份",
      markdownStatus: "状态"
    },
    en: {
      appName: "ChatGPT Local Backup",
      appShortName: "Local Backup",
      backupLibrary: "Backup Library",
      backupLibraryLoading: "Loading local backups",
      backupLibraryStats: "{conversations} conversations · {messages} messages · local only",
      chatgptConversations: "ChatGPT conversations",
      currentPage: "Current page",
      checking: "Checking",
      inactive: "Inactive",
      ready: "Ready",
      watching: "Watching",
      paused: "Paused",
      failed: "Failed",
      saved: "Saved",
      openChatgptHint: "Open a ChatGPT conversation to start backing it up.",
      openChatgptToBackup: "Open chatgpt.com or chat.openai.com to back up the visible conversation.",
      detectedMessages: "{title} · {count} messages detected",
      autoBackupLabel: "Auto-backup visible ChatGPT conversations",
      uploadBackupLabel: "Back up my uploaded file contents",
      uploadBackupHint: "Off by default. When enabled, the extension saves file contents when you choose upload files. Limit: 50MB per file.",
      saveNow: "Save now",
      saving: "Saving",
      exportCurrent: "Export current",
      conversations: "conversations",
      messages: "messages",
      attachments: "attachments",
      lastBackup: "Last backup",
      noBackupsYet: "No local backups yet.",
      exportAllJson: "Export all JSON",
      exportAllMarkdown: "Export all Markdown",
      clearAll: "Clear all",
      searchConversations: "Search conversations",
      noConversationSelected: "No conversation selected",
      openChatgptStart: "Open ChatGPT and start chatting, then your local backups will appear here.",
      chooseLocalBackup: "Choose a local backup from the list.",
      noMatchingBackups: "No matching backups.",
      source: "Source",
      lastBackupLabel: "Last backup",
      status: "Status",
      unknown: "Unknown",
      favorite: "Favorite",
      markdown: "Markdown",
      json: "JSON",
      download: "Download",
      metadataOnly: "metadata only",
      savedLocally: "saved locally",
      attachmentList: "Attachments",
      delete: "Delete",
      deleteConversationConfirm: "Delete this local backup? This does not delete anything from ChatGPT.",
      conversationDeleted: "Conversation deleted.",
      clearAllConfirm: "Clear every local backup in this browser profile?",
      allCleared: "All local backups cleared.",
      exportFailed: "Export failed.",
      openFailed: "Could not open conversation.",
      loadFailed: "Could not load local backups.",
      userRole: "User",
      assistantRole: "Assistant",
      messageRole: "Message",
      untitled: "Untitled conversation",
      localOnly: "local only",
      openBackupLibrary: "Open backup library",
      language: "Language",
      chinese: "中文",
      english: "English",
      badgeWatching: "Backup: watching",
      badgePaused: "Backup: paused",
      badgeNoMessages: "Backup: no messages found",
      badgeSavingDraft: "Backup: saving draft",
      badgeSaving: "Backup: saving",
      badgeFailedUnavailable: "Backup failed: extension unavailable",
      badgeFailed: "Backup failed",
      badgeSavedMessages: "Backup: saved {count} messages",
      badgeSavedWithAttachments: "Backup: saved {messages} messages, {attachments} attachments",
      markdownSource: "Source",
      markdownLastBackup: "Last backup",
      markdownStatus: "Status"
    }
  };

  function normalizeLocale(locale) {
    return locale === "en" ? "en" : DEFAULT_LOCALE;
  }

  function format(template, values) {
    return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => {
      return values && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "";
    });
  }

  function t(locale, key, values) {
    const normalized = normalizeLocale(locale);
    const template = messages[normalized][key] || messages.en[key] || key;
    return format(template, values);
  }

  async function getLocale() {
    if (!global.chrome?.storage?.local) {
      return DEFAULT_LOCALE;
    }

    const result = await chrome.storage.local.get({
      locale: DEFAULT_LOCALE
    });
    return normalizeLocale(result.locale);
  }

  async function setLocale(locale) {
    const normalized = normalizeLocale(locale);
    await chrome.storage.local.set({
      locale: normalized
    });
    return normalized;
  }

  function applyDocumentLocale(locale) {
    document.documentElement.lang = normalizeLocale(locale) === "zh" ? "zh-CN" : "en";
  }

  global.ChatBackupI18n = {
    DEFAULT_LOCALE,
    applyDocumentLocale,
    getLocale,
    messages,
    normalizeLocale,
    setLocale,
    t
  };
})(globalThis);
