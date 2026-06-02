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
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
  const MIN_PAGE_IMAGE_AREA = 240 * 240;
  const uploadedFileBackups = new Map();

  let saveTimer = null;
  let completeTimer = null;
  let lastSignature = "";
  let lastSnapshot = null;
  let lastResult = null;
  let observer = null;
  let backupEnabled = true;
  let uploadBackupEnabled = false;
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

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    });
  }

  async function fileToDataUrl(file) {
    if (!file || file.size > MAX_UPLOAD_BYTES) {
      return "";
    }
    return blobToDataUrl(file);
  }

  function fileKey(file) {
    return [
      file.name,
      file.size,
      file.type,
      file.lastModified
    ].join(":");
  }

  async function captureUploadedFiles(input) {
    if (!input?.files?.length) {
      return;
    }

    for (const file of Array.from(input.files)) {
      const key = fileKey(file);
      if (uploadedFileBackups.has(key)) {
        continue;
      }

      const dataUrl = uploadBackupEnabled ? await fileToDataUrl(file) : "";
      uploadedFileBackups.set(key, {
        type: "upload",
        source: "user_upload",
        name: file.name || "uploaded-file",
        mimeType: file.type || "",
        size: file.size,
        lastModified: file.lastModified || null,
        dataUrl,
        contentSaved: Boolean(dataUrl),
        captureStatus: dataUrl ? "saved" : "metadata_only"
      });
    }

    scheduleSave("uploaded-file");
  }

  function watchUploadInputs() {
    document.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "file") {
        return;
      }
      captureUploadedFiles(input).catch(() => {});
    }, true);
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
    clone.querySelectorAll("button, svg, style, script, noscript, img, video, audio, canvas, [aria-hidden='true']").forEach((item) => item.remove());
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
      return text.length > 0 || Boolean(node.querySelector("img, a[href]"));
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

  function absoluteUrl(value) {
    if (!value) {
      return "";
    }

    try {
      return new URL(value, location.href).href;
    } catch {
      return String(value || "");
    }
  }

  function filenameFromUrl(value, fallback) {
    try {
      const url = new URL(value);
      const lastSegment = url.pathname.split("/").filter(Boolean).pop();
      return decodeURIComponent(lastSegment || fallback || "attachment");
    } catch {
      return fallback || "attachment";
    }
  }

  function bestSrcFromSrcset(value) {
    if (!value) {
      return "";
    }

    const candidates = String(value)
      .split(",")
      .map((item) => {
        const [url, descriptor] = item.trim().split(/\s+/);
        const width = descriptor?.endsWith("w") ? Number.parseInt(descriptor, 10) : 0;
        return {
          url,
          width: Number.isFinite(width) ? width : 0
        };
      })
      .filter((candidate) => candidate.url);

    candidates.sort((a, b) => b.width - a.width);
    return candidates[0]?.url || "";
  }

  function urlFromCssBackground(value) {
    const match = String(value || "").match(/url\((['"]?)(.*?)\1\)/i);
    return match?.[2] || "";
  }

  function collectBackgroundImages(node, messageIndex, role) {
    const candidates = Array.from(node.querySelectorAll("[style]"));
    const attachments = [];

    candidates.forEach((element, index) => {
      if (!isVisible(element)) {
        return;
      }

      const backgroundImage = getComputedStyle(element).backgroundImage;
      const src = absoluteUrl(urlFromCssBackground(backgroundImage));
      if (!src || src === location.href) {
        return;
      }

      attachments.push({
        type: "image",
        source: role === "user" ? "user_visible_background_image" : "assistant_visible_background_image",
        name: filenameFromUrl(src, `background-image-${messageIndex + 1}-${index + 1}`),
        src,
        width: Math.round(element.getBoundingClientRect().width) || null,
        height: Math.round(element.getBoundingClientRect().height) || null,
        messageIndex,
        role,
        captureStatus: "metadata_only"
      });
    });

    return attachments;
  }

  function looksLikeBackupImageUrl(value) {
    return /(oaiusercontent|oaistatic|files\.oaiusercontent|oaidalleapiprodscus|oaidalleapiprod|dalle|blob\.core\.windows\.net)/i.test(String(value || ""));
  }

  function shouldIgnoreImageUrl(value) {
    const url = String(value || "");
    return /cdn\.auth0\.com\/avatars|google\.com\/s2\/favicons|favicon|\/avatar|gravatar|profile|developers\.openai\.com/i.test(url);
  }

  function collectPageImageAttachments() {
    const attachments = [];
    const seen = new Set();

    function addAttachment(attachment) {
      const src = attachment.src || attachment.href;
      if (!src || seen.has(src) || src.startsWith("data:image/svg") || shouldIgnoreImageUrl(src)) {
        return;
      }
      seen.add(src);
      attachments.push(attachment);
    }

    Array.from(document.querySelectorAll("img")).forEach((image, index) => {
      if (!isVisible(image)) {
        return;
      }

      const rect = image.getBoundingClientRect();
      const src = absoluteUrl(
        image.currentSrc ||
        image.src ||
        image.getAttribute("src") ||
        bestSrcFromSrcset(image.getAttribute("srcset"))
      );
      const area = Math.max(rect.width, image.naturalWidth || 0) * Math.max(rect.height, image.naturalHeight || 0);

      if (shouldIgnoreImageUrl(src) || area < MIN_PAGE_IMAGE_AREA || !looksLikeBackupImageUrl(src)) {
        return;
      }

      addAttachment({
        type: "image",
        source: "page_visible_image",
        name: image.alt || image.getAttribute("aria-label") || filenameFromUrl(src, `page-image-${index + 1}`),
        alt: image.alt || "",
        src,
        href: absoluteUrl(image.closest("a[href]")?.href || ""),
        width: image.naturalWidth || Math.round(rect.width) || null,
        height: image.naturalHeight || Math.round(rect.height) || null,
        captureStatus: "metadata_only"
      });
    });

    Array.from(document.querySelectorAll("a[href]")).forEach((link, index) => {
      const href = absoluteUrl(link.href || link.getAttribute("href"));
      if (shouldIgnoreImageUrl(href) || !looksLikeBackupImageUrl(href)) {
        return;
      }

      const text = stripNoise(link.innerText || link.textContent || "");
      addAttachment({
        type: "image",
        source: "page_visible_image_link",
        name: text || filenameFromUrl(href, `page-image-link-${index + 1}`),
        href,
        src: href,
        captureStatus: "metadata_only"
      });
    });

    Array.from(document.querySelectorAll("[style]")).forEach((element, index) => {
      if (!isVisible(element)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const src = absoluteUrl(urlFromCssBackground(getComputedStyle(element).backgroundImage));
      if (!src || shouldIgnoreImageUrl(src) || rect.width * rect.height < MIN_PAGE_IMAGE_AREA || !looksLikeBackupImageUrl(src)) {
        return;
      }

      addAttachment({
        type: "image",
        source: "page_visible_background_image",
        name: filenameFromUrl(src, `page-background-image-${index + 1}`),
        src,
        width: Math.round(rect.width) || null,
        height: Math.round(rect.height) || null,
        captureStatus: "metadata_only"
      });
    });

    return attachments;
  }

  function collectImageAttachments(node, messageIndex, role) {
    return Array.from(node.querySelectorAll("img"))
      .filter((image) => isVisible(image))
      .map((image, index) => {
        const src = absoluteUrl(
          image.currentSrc ||
          image.src ||
          image.getAttribute("src") ||
          bestSrcFromSrcset(image.getAttribute("srcset"))
        );
        const linkedImage = image.closest("a[href]")?.href || "";
        const alt = image.alt || image.getAttribute("aria-label") || "";
        return {
          type: "image",
          source: role === "user" ? "user_visible_image" : "assistant_visible_image",
          name: alt || filenameFromUrl(src, `image-${messageIndex + 1}-${index + 1}`),
          alt,
          src,
          href: absoluteUrl(linkedImage),
          width: image.naturalWidth || image.width || null,
          height: image.naturalHeight || image.height || null,
          messageIndex,
          role,
          captureStatus: "metadata_only"
        };
      })
      .filter((attachment) => attachment.src);
  }

  function collectLinkAttachments(node, messageIndex, role) {
    return Array.from(node.querySelectorAll("a[href]"))
      .map((link, index) => {
        const href = absoluteUrl(link.href || link.getAttribute("href"));
        const text = stripNoise(link.innerText || link.textContent || "");
        const hasFileExtension = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|txt|json|md|png|jpe?g|webp|gif|mp4|mov|mp3|wav)(\?|#|$)/i.test(href);
        const hasDownloadIntent = /download|attachment|file|下载|附件/i.test(href + " " + text);
        const isOpenAiImage = looksLikeBackupImageUrl(href);
        const looksLikeFile = !shouldIgnoreImageUrl(href) && (hasFileExtension || hasDownloadIntent || isOpenAiImage);

        if (!looksLikeFile) {
          return null;
        }

        return {
          type: /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(href) || isOpenAiImage ? "image" : "file",
          source: role === "user" ? "user_visible_link" : "assistant_visible_link",
          name: text || filenameFromUrl(href, `file-${messageIndex + 1}-${index + 1}`),
          href,
          src: href,
          messageIndex,
          role,
          captureStatus: "metadata_only"
        };
      })
      .filter(Boolean);
  }

  async function enrichImageAttachment(attachment) {
    if (!attachment.src || attachment.src.startsWith("data:")) {
      return attachment.src?.startsWith("data:")
        ? {
            ...attachment,
            dataUrl: attachment.src,
            contentSaved: true,
            captureStatus: "saved"
          }
        : attachment;
    }

    try {
      const backgroundResponse = await sendRuntimeMessage({
        type: "FETCH_ATTACHMENT_DATA_URL",
        url: attachment.href || attachment.src,
        maxBytes: MAX_IMAGE_BYTES
      });

      if (backgroundResponse?.ok && backgroundResponse.result?.captureStatus === "saved") {
        return {
          ...attachment,
          ...backgroundResponse.result,
          contentSaved: true
        };
      }

      if (backgroundResponse?.ok && backgroundResponse.result?.captureStatus === "too_large") {
        return {
          ...attachment,
          ...backgroundResponse.result,
          contentSaved: false
        };
      }

      const response = await fetch(attachment.href || attachment.src);
      if (!response.ok) {
        return {
          ...attachment,
          captureStatus: "metadata_only",
          captureError: `http_${response.status}`
        };
      }

      const blob = await response.blob();
      if (blob.size > MAX_IMAGE_BYTES) {
        return {
          ...attachment,
          mimeType: blob.type || attachment.mimeType || "",
          size: blob.size,
          captureStatus: "too_large"
        };
      }

      const dataUrl = await blobToDataUrl(blob);
      return {
        ...attachment,
        mimeType: blob.type || attachment.mimeType || "",
        size: blob.size,
        dataUrl,
        contentSaved: true,
        captureStatus: "saved"
      };
    } catch {
      return {
        ...attachment,
        captureStatus: "metadata_only",
        captureError: "fetch_failed"
      };
    }
  }

  async function enrichConversationAttachments(attachments) {
    const enriched = [];
    const seen = new Set();

    for (const attachment of attachments || []) {
      const key = `${attachment.type}:${attachment.src || attachment.href || attachment.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      if (attachment.type === "image") {
        enriched.push(await enrichImageAttachment(attachment));
      } else {
        enriched.push(attachment);
      }
    }

    return enriched;
  }

  async function enrichAttachments(messages) {
    for (const message of messages) {
      const enriched = [];
      const seen = new Set();
      for (const attachment of message.attachments || []) {
        const key = `${attachment.type}:${attachment.src || attachment.href || attachment.name}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        if (attachment.type === "image" && attachment.source.startsWith("assistant_")) {
          enriched.push(await enrichImageAttachment(attachment));
        } else {
          enriched.push(attachment);
        }
      }
      message.attachments = enriched;
    }

    return messages;
  }

  async function collectMessages() {
    const nodes = collectRoleNodes();
    const messages = [];

    nodes.forEach((node) => {
      if (!isVisible(node)) {
        return;
      }

      const role = inferRole(node, messages.length);
      const normalizedRole = role === "assistant" || role === "user" ? role : role || "unknown";
      const content = getNodeText(node);
      const attachments = [
        ...collectImageAttachments(node, messages.length, normalizedRole),
        ...collectBackgroundImages(node, messages.length, normalizedRole),
        ...collectLinkAttachments(node, messages.length, normalizedRole)
      ];

      if ((!content || content.length < 1) && !attachments.length) {
        return;
      }

      messages.push({
        index: messages.length,
        role: normalizedRole,
        content,
        attachments,
        status: "complete"
      });
    });

    return enrichAttachments(messages);
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
    const messages = detectStreaming(await collectMessages());
    const conversationId = getConversationIdFromUrl();
    const titleFromHeading = document.querySelector("main h1")?.innerText || "";
    const title = normalizeTitle(titleFromHeading || document.title || messages[0]?.content?.slice(0, 80));
    const status = messages.some((message) => message.status === "streaming") ? "generating" : "complete";
    const uploadAttachments = uploadBackupEnabled
      ? Array.from(uploadedFileBackups.values())
      : Array.from(uploadedFileBackups.values()).map((attachment) => ({
          ...attachment,
          dataUrl: "",
          contentSaved: false,
          captureStatus: "metadata_only"
        }));
    const pageImageAttachments = await enrichConversationAttachments(collectPageImageAttachments());

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
      messages,
      attachments: [
        ...uploadAttachments,
        ...pageImageAttachments
      ]
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
        message.attachments?.length || 0,
        message.content.slice(0, 64),
        message.content.slice(-64)
      ]),
      attachments: snapshot.attachments?.map((attachment) => [
        attachment.name,
        attachment.src,
        attachment.size,
        attachment.captureStatus,
        attachment.captureError,
        Boolean(attachment.dataUrl)
      ]) || []
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
        const attachmentCount = response.result.savedAttachments || 0;
        setBadge(attachmentCount
          ? t("badgeSavedWithAttachments", {
              messages: count,
              attachments: attachmentCount
            })
          : t("badgeSavedMessages", {
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
      uploadBackupEnabled: false,
      locale: "zh"
    });
    backupEnabled = Boolean(settings.backupEnabled);
    uploadBackupEnabled = Boolean(settings.uploadBackupEnabled);
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

    if (changes.uploadBackupEnabled) {
      uploadBackupEnabled = Boolean(changes.uploadBackupEnabled.newValue);
      scheduleSave("upload-setting");
    }

    setBadge(backupEnabled ? t("badgeWatching") : t("badgePaused"), backupEnabled ? "neutral" : "warn");
  });

  ensureBadge();
  loadSettings().finally(() => {
    watchHistoryChanges();
    watchUploadInputs();
    startObserver();
    scheduleSave("startup");
  });
})();
