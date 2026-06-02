(function attachBackupExport(global) {
  "use strict";

  function safeFilename(value) {
    return String(value || "conversation")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "conversation";
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  }

  function conversationToMarkdown(item, locale) {
    const conversation = item.conversation || {};
    const messages = item.messages || [];
    const conversationAttachments = (item.attachments || []).filter((attachment) => !attachment.messageId);
    const i18n = global.ChatBackupI18n;
    const t = i18n
      ? (key, values) => i18n.t(locale || i18n.DEFAULT_LOCALE, key, values)
      : (key) => key;
    const lines = [
      `# ${conversation.title || t("untitled")}`,
      "",
      `- ${t("markdownSource")}: ${conversation.source || "chatgpt_web"}`,
      `- ${t("markdownLastBackup")}: ${formatDate(conversation.lastBackupAt) || t("unknown")}`,
      `- ${t("markdownStatus")}: ${conversation.status || t("unknown")}`,
      ""
    ];

    for (const message of messages) {
      const role = message.role === "assistant" ? t("assistantRole") : message.role === "user" ? t("userRole") : message.role || t("messageRole");
      lines.push(`## ${role}`);
      lines.push("");
      lines.push(message.content || "");
      lines.push("");
      if (message.attachments?.length) {
        lines.push(`### ${t("attachmentList")}`);
        lines.push("");
        for (const attachment of message.attachments) {
          const state = attachment.savedLocally ? t("savedLocally") : t("metadataOnly");
          lines.push(`- ${attachment.name || attachment.type || "attachment"} (${attachment.type || "file"}, ${state})`);
          if (attachment.src) {
            lines.push(`  - URL: ${attachment.src}`);
          }
        }
        lines.push("");
      }
    }

    if (conversationAttachments.length) {
      lines.push(`## ${t("attachmentList")}`);
      lines.push("");
      for (const attachment of conversationAttachments) {
        const state = attachment.savedLocally ? t("savedLocally") : t("metadataOnly");
        lines.push(`- ${attachment.name || attachment.type || "attachment"} (${attachment.type || "file"}, ${state})`);
      }
      lines.push("");
    }

    return lines.join("\n").trim() + "\n";
  }

  function downloadText(filename, content, mimeType) {
    const blob = new Blob([content], {
      type: mimeType || "text/plain;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: true
      },
      () => {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    );
  }

  function downloadJson(filename, data) {
    downloadText(filename, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  }

  function downloadMarkdown(filename, item, locale) {
    downloadText(filename, conversationToMarkdown(item, locale), "text/markdown;charset=utf-8");
  }

  global.ChatBackupExport = {
    conversationToMarkdown,
    downloadJson,
    downloadMarkdown,
    downloadText,
    safeFilename
  };
})(globalThis);
