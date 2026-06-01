(function installChatBackupContentScript() {
  "use strict";

  if (window.__chatBackupInstalled) {
    return;
  }

  window.__chatBackupInstalled = true;

  const SAVE_DEBOUNCE_MS = 1200;
  const IDLE_COMPLETE_MS = 3500;
  const BADGE_ID = "chatgpt-local-backup-status";
  const SUPPORTED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

  let saveTimer = null;
  let completeTimer = null;
  let lastSignature = "";
  let lastSnapshot = null;
  let lastResult = null;
  let observer = null;
  let backupEnabled = true;
  let locale = "zh";

  function t(key, values) {
    return ChatBackupI18n.t(locale, key, values);
  }

  function isSupportedPage() {
    return SUPPORTED_HOSTS.has(location.hostname);
  }

  function ensureSessionId() {
    const key = "chatgptLocalBackupDraftId";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  }

  async function sha256(value) {
    const input = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest))
      .map((part) => part.toString(16).padStart(2, "0"))
      .join("");
  }

  function normalizeTitle(value) {
    const title = String(value || "")
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
      .replace(/^ChatGPT\s*[-|]\s*/i, "")
      .trim();

    return title && title.toLowerCase() !== "chatgpt" ? title : "Untitled conversation";
  }

  function getConversationIdFromUrl() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    if (match && match[1]) {
      return `chatgpt-${match[1]}`;
    }

    return ensureSessionId();
  }

  async function getUrlHash() {
    return sha256(`${location.origin}${location.pathname}`);
  }

  function stripNoise(text) {
    const noise = new Set([
      "Copy",
      "Copied",
      "Edit",
      "Retry",
      "Share",
      "Read aloud",
      "Good response",
      "Bad response",
      "Regenerate",
      "Stop generating"
    ]);

    return String(text || "")
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => !noise.has(line.trim()))
      .join("\n")
      .trim();
  }

  function getNodeText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("button, svg, style, script, noscript, [aria-hidden='true']").forEach((item) => item.remove());
    return stripNoise(clone.innerText || clone.textContent || "");
  }

  function isVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function collectRoleNodes() {
    const roleNodes = Array.from(document.querySelectorAll("[data-message-author-role]"));
    if (roleNodes.length) {
      return roleNodes;
    }

    return Array.from(document.querySelectorAll("article")).filter((node) => {
      const text = getNodeText(node);
      return text.length > 0;
    });
  }

  function inferRole(node, index) {
    const explicit = node.getAttribute("data-message-author-role");
    if (explicit) {
      return explicit;
    }

    const text = node.innerText || "";
    if (/^\s*(you|user)\s*$/i.test(node.getAttribute("aria-label") || "")) {
      return "user";
    }

    if (text.includes("ChatGPT") || text.includes("Assistant")) {
      return "assistant";
    }

    return index % 2 === 0 ? "user" : "assistant";
  }

  function collectMessages() {
    const nodes = collectRoleNodes();
    const messages = [];

    nodes.forEach((node) => {
      if (!isVisible(node)) {
        return;
      }

      const role = inferRole(node, messages.length);
      const normalizedRole = role === "assistant" || role === "user" ? role : role || "unknown";
      const content = getNodeText(node);

      if (!content || content.length < 1) {
        return;
      }

      messages.push({
        index: messages.length,
        role: normalizedRole,
        content,
        status: "complete"
      });
    });

    return messages;
  }

  function detectStreaming(messages) {
    const stopButton = Array.from(document.querySelectorAll("button")).some((button) => {
      return /stop|停止|cancel/i.test(button.innerText || button.getAttribute("aria-label") || "");
    });

    if (stopButton && messages.length) {
      const last = messages[messages.length - 1];
      if (last.role === "assistant") {
        last.status = "streaming";
      }
    }

    return messages;
  }

  async function buildSnapshot() {
    const messages = detectStreaming(collectMessages());
    const conversationId = getConversationIdFromUrl();
    const titleFromHeading = document.querySelector("main h1")?.innerText || "";
    const title = normalizeTitle(titleFromHeading || document.title || messages[0]?.content?.slice(0, 80));
    const status = messages.some((message) => message.status === "streaming") ? "generating" : "complete";

    return {
      conversation: {
        id: conversationId,
        source: "chatgpt_web",
        sourceUrl: location.href,
        urlHash: await getUrlHash(),
        title,
        updatedAt: new Date().toISOString(),
        status
      },
      messages
    };
  }

  function snapshotSignature(snapshot) {
    return JSON.stringify({
      id: snapshot.conversation.id,
      title: snapshot.conversation.title,
      status: snapshot.conversation.status,
      messages: snapshot.messages.map((message) => [
        message.role,
        message.status,
        message.content.length,
        message.content.slice(0, 64),
        message.content.slice(-64)
      ])
    });
  }

  function ensureBadge() {
    let badge = document.getElementById(BADGE_ID);
    if (badge) {
      return badge;
    }

    badge = document.createElement("div");
    badge.id = BADGE_ID;
    badge.setAttribute("role", "status");
    badge.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "z-index:2147483647",
      "max-width:260px",
      "padding:8px 10px",
      "border-radius:8px",
      "background:#111827",
      "color:#f9fafb",
      "box-shadow:0 8px 24px rgba(0,0,0,.24)",
      "font:12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "letter-spacing:0",
      "cursor:default",
      "opacity:.94"
    ].join(";");
    badge.textContent = t("badgeWatching");
    document.documentElement.appendChild(badge);
    return badge;
  }

  function setBadge(text, tone) {
    const badge = ensureBadge();
    const colors = {
      ok: "#065f46",
      warn: "#92400e",
      error: "#991b1b",
      neutral: "#111827"
    };

    badge.style.background = colors[tone] || colors.neutral;
    badge.textContent = text;
  }

  async function saveSnapshot(reason) {
    if (!isSupportedPage()) {
      return;
    }

    if (!backupEnabled) {
      setBadge(t("badgePaused"), "warn");
      return;
    }

    const snapshot = await buildSnapshot();
    if (!snapshot.messages.length) {
      lastSnapshot = snapshot;
      setBadge(t("badgeNoMessages"), "warn");
      return;
    }

    const signature = snapshotSignature(snapshot);
    if (signature === lastSignature && reason !== "force") {
      return;
    }

    lastSignature = signature;
    lastSnapshot = snapshot;
    setBadge(snapshot.conversation.status === "generating" ? t("badgeSavingDraft") : t("badgeSaving"), "neutral");

    chrome.runtime.sendMessage(
      {
        type: "BACKUP_SNAPSHOT",
        snapshot
      },
      (response) => {
        if (chrome.runtime.lastError) {
          lastResult = {
            ok: false,
            error: chrome.runtime.lastError.message
          };
          setBadge(t("badgeFailedUnavailable"), "error");
          return;
        }

        if (!response || !response.ok) {
          lastResult = {
            ok: false,
            error: response?.error || "Unknown error"
          };
          setBadge(t("badgeFailed"), "error");
          return;
        }

        lastResult = response.result;
        const count = response.result.savedMessages || snapshot.messages.length;
        setBadge(t("badgeSavedMessages", {
          count
        }), "ok");
      }
    );
  }

  function scheduleSave(reason) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveSnapshot(reason).catch((error) => {
        lastResult = {
          ok: false,
          error: error?.message || String(error)
        };
        setBadge(t("badgeFailed"), "error");
      });
    }, SAVE_DEBOUNCE_MS);

    window.clearTimeout(completeTimer);
    completeTimer = window.setTimeout(() => {
      saveSnapshot("idle-complete").catch(() => {});
    }, IDLE_COMPLETE_MS);
  }

  function watchHistoryChanges() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function pushStateWrapper(...args) {
      const result = originalPushState.apply(this, args);
      scheduleSave("url-change");
      return result;
    };

    history.replaceState = function replaceStateWrapper(...args) {
      const result = originalReplaceState.apply(this, args);
      scheduleSave("url-change");
      return result;
    };

    window.addEventListener("popstate", () => scheduleSave("url-change"));
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        return mutation.type === "childList" || mutation.type === "characterData";
      });

      if (relevant) {
        scheduleSave("mutation");
      }
    });

    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PAGE_STATUS") {
      sendResponse({
        ok: true,
        supported: isSupportedPage(),
        snapshot: lastSnapshot,
        result: lastResult,
        url: location.href
      });
      return true;
    }

    if (message?.type === "FORCE_BACKUP") {
      saveSnapshot("force")
        .then(() => {
          sendResponse({
            ok: true,
            snapshot: lastSnapshot,
            result: lastResult
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

    return false;
  });

  async function loadSettings() {
    const settings = await chrome.storage.local.get({
      backupEnabled: true,
      locale: "zh"
    });
    backupEnabled = Boolean(settings.backupEnabled);
    locale = ChatBackupI18n.normalizeLocale(settings.locale);
    setBadge(backupEnabled ? t("badgeWatching") : t("badgePaused"), backupEnabled ? "neutral" : "warn");
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (changes.locale) {
      locale = ChatBackupI18n.normalizeLocale(changes.locale.newValue);
    }

    if (changes.backupEnabled) {
      backupEnabled = Boolean(changes.backupEnabled.newValue);
      if (backupEnabled) {
        scheduleSave("enabled");
      }
    }

    setBadge(backupEnabled ? t("badgeWatching") : t("badgePaused"), backupEnabled ? "neutral" : "warn");
  });

  ensureBadge();
  loadSettings().finally(() => {
    watchHistoryChanges();
    startObserver();
    scheduleSave("startup");
  });
})();
