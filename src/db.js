(function attachBackupDb(global) {
  "use strict";

  const DB_NAME = "chatgpt-local-backup";
  const DB_VERSION = 2;
  const STORES = {
    attachments: "attachments",
    conversations: "conversations",
    messages: "messages"
  };

  let openPromise = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function stableMessageId(conversationId, index, role) {
    return `${conversationId}:${String(index).padStart(5, "0")}:${role || "unknown"}`;
  }

  async function sha256(value) {
    const input = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest))
      .map((part) => part.toString(16).padStart(2, "0"))
      .join("");
  }

  function openDb() {
    if (openPromise) {
      return openPromise;
    }

    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORES.conversations)) {
          const conversations = db.createObjectStore(STORES.conversations, {
            keyPath: "id"
          });
          conversations.createIndex("updatedAt", "updatedAt");
          conversations.createIndex("lastBackupAt", "lastBackupAt");
          conversations.createIndex("source", "source");
          conversations.createIndex("favorite", "favorite");
        }

        if (!db.objectStoreNames.contains(STORES.messages)) {
          const messages = db.createObjectStore(STORES.messages, {
            keyPath: "id"
          });
          messages.createIndex("conversationId", "conversationId");
          messages.createIndex("updatedAt", "updatedAt");
          messages.createIndex("contentHash", "contentHash");
        }

        if (!db.objectStoreNames.contains(STORES.attachments)) {
          const attachments = db.createObjectStore(STORES.attachments, {
            keyPath: "id"
          });
          attachments.createIndex("conversationId", "conversationId");
          attachments.createIndex("messageId", "messageId");
          attachments.createIndex("sourceHash", "sourceHash");
          attachments.createIndex("type", "type");
          attachments.createIndex("updatedAt", "updatedAt");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return openPromise;
  }

  async function tx(storeNames, mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, mode);
      const stores = Array.isArray(storeNames)
        ? storeNames.map((name) => transaction.objectStore(name))
        : transaction.objectStore(storeNames);
      let callbackResult;

      transaction.oncomplete = () => resolve(callbackResult);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);

      try {
        callbackResult = callback(stores, transaction);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveSnapshot(snapshot) {
    if (!snapshot || !snapshot.conversation || !snapshot.conversation.id) {
      throw new Error("Invalid conversation snapshot.");
    }

    const backupTime = nowIso();
    const conversationId = snapshot.conversation.id;
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    const conversationAttachments = Array.isArray(snapshot.attachments) ? snapshot.attachments : [];
    const normalizedMessages = [];
    const normalizedAttachments = [];

    async function normalizeAttachment(attachment, message) {
      const name = String(attachment.name || attachment.alt || attachment.filename || "").trim();
      const src = String(attachment.src || attachment.href || "").trim();
      const dataUrl = typeof attachment.dataUrl === "string" ? attachment.dataUrl : "";
      const sourceHash = attachment.sourceHash || await sha256([
        attachment.type || "attachment",
        attachment.source || "",
        src,
        name,
        attachment.size || ""
      ].join("\n"));
      const dataHash = dataUrl ? await sha256(dataUrl) : "";
      const messageId = message?.id || attachment.messageId || "";
      const id = `${conversationId}:attachment:${sourceHash}:${messageId || "conversation"}`;

      return {
        id,
        conversationId,
        messageId,
        messageIndex: Number.isFinite(attachment.messageIndex) ? attachment.messageIndex : message?.index ?? null,
        role: attachment.role || message?.role || "",
        type: attachment.type || "file",
        source: attachment.source || "page",
        name: name || attachment.type || "attachment",
        alt: attachment.alt || "",
        mimeType: attachment.mimeType || "",
        size: Number.isFinite(attachment.size) ? attachment.size : null,
        width: Number.isFinite(attachment.width) ? attachment.width : null,
        height: Number.isFinite(attachment.height) ? attachment.height : null,
        src,
        sourceHash,
        dataHash,
        dataUrl,
        savedLocally: Boolean(dataUrl),
        contentSaved: Boolean(attachment.contentSaved || dataUrl),
        captureStatus: attachment.captureStatus || (dataUrl ? "saved" : "metadata_only"),
        createdAt: attachment.createdAt || backupTime,
        updatedAt: backupTime
      };
    }

    for (const message of messages) {
      const role = message.role || "unknown";
      const index = Number.isFinite(message.index) ? message.index : normalizedMessages.length;
      const content = String(message.content || "").trim();
      const messageAttachments = Array.isArray(message.attachments) ? message.attachments : [];

      if (!content && !messageAttachments.length) {
        continue;
      }

      const contentHash = await sha256(`${role}\n${content}\n${messageAttachments.length}`);
      const normalizedMessage = {
        id: stableMessageId(conversationId, index, role),
        conversationId,
        role,
        content,
        contentHash,
        index,
        status: message.status || "complete",
        attachmentCount: messageAttachments.length,
        createdAt: message.createdAt || backupTime,
        updatedAt: backupTime
      };

      normalizedMessages.push(normalizedMessage);

      for (const attachment of messageAttachments) {
        normalizedAttachments.push(await normalizeAttachment(attachment, normalizedMessage));
      }
    }

    for (const attachment of conversationAttachments) {
      normalizedAttachments.push(await normalizeAttachment(attachment, null));
    }

    let savedMessages = 0;
    let changedMessages = 0;
    let savedAttachments = 0;
    let changedAttachments = 0;

    await tx([STORES.conversations, STORES.messages, STORES.attachments], "readwrite", ([conversationStore, messageStore, attachmentStore]) => {
      const existingConversationRequest = conversationStore.get(conversationId);

      existingConversationRequest.onsuccess = () => {
        const existing = existingConversationRequest.result || {};
        const nextConversation = {
          id: conversationId,
          source: snapshot.conversation.source || "chatgpt_web",
          sourceUrl: snapshot.conversation.sourceUrl || existing.sourceUrl || "",
          urlHash: snapshot.conversation.urlHash || existing.urlHash || "",
          title: snapshot.conversation.title || existing.title || "Untitled conversation",
          createdAt: existing.createdAt || snapshot.conversation.createdAt || backupTime,
          updatedAt: snapshot.conversation.updatedAt || backupTime,
          lastBackupAt: backupTime,
          messageCount: Math.max(existing.messageCount || 0, normalizedMessages.length),
          attachmentCount: Math.max(existing.attachmentCount || 0, normalizedAttachments.length),
          status: snapshot.conversation.status || "complete",
          favorite: Boolean(existing.favorite),
          tags: Array.isArray(existing.tags) ? existing.tags : []
        };

        conversationStore.put(nextConversation);
      };

      for (const message of normalizedMessages) {
        const existingMessageRequest = messageStore.get(message.id);

        existingMessageRequest.onsuccess = () => {
          const existing = existingMessageRequest.result;
          savedMessages += 1;

          if (!existing || existing.contentHash !== message.contentHash || existing.status !== message.status) {
            changedMessages += 1;
            messageStore.put({
              ...existing,
              ...message,
              createdAt: existing?.createdAt || message.createdAt
            });
          }
        };
      }

      for (const attachment of normalizedAttachments) {
        const existingAttachmentRequest = attachmentStore.get(attachment.id);

        existingAttachmentRequest.onsuccess = () => {
          const existing = existingAttachmentRequest.result;
          savedAttachments += 1;

          if (
            !existing ||
            existing.dataHash !== attachment.dataHash ||
            existing.captureStatus !== attachment.captureStatus ||
            existing.name !== attachment.name
          ) {
            changedAttachments += 1;
            attachmentStore.put({
              ...existing,
              ...attachment,
              createdAt: existing?.createdAt || attachment.createdAt
            });
          }
        };
      }
    });

    return {
      conversationId,
      savedMessages,
      changedMessages,
      savedAttachments,
      changedAttachments,
      lastBackupAt: backupTime
    };
  }

  async function listConversations() {
    const db = await openDb();
    const transaction = db.transaction(STORES.conversations, "readonly");
    const request = transaction.objectStore(STORES.conversations).getAll();
    const conversations = await requestToPromise(request);

    return conversations.sort((a, b) => {
      return String(b.lastBackupAt || b.updatedAt || "").localeCompare(String(a.lastBackupAt || a.updatedAt || ""));
    });
  }

  async function getConversation(conversationId) {
    const db = await openDb();
    const transaction = db.transaction([STORES.conversations, STORES.messages, STORES.attachments], "readonly");
    const conversation = await requestToPromise(
      transaction.objectStore(STORES.conversations).get(conversationId)
    );
    const messageIndex = transaction.objectStore(STORES.messages).index("conversationId");
    const messages = await requestToPromise(messageIndex.getAll(conversationId));
    const attachmentIndex = transaction.objectStore(STORES.attachments).index("conversationId");
    const attachments = await requestToPromise(attachmentIndex.getAll(conversationId));

    messages.sort((a, b) => a.index - b.index);
    attachments.sort((a, b) => {
      return (a.messageIndex ?? 999999) - (b.messageIndex ?? 999999) ||
        String(a.name || "").localeCompare(String(b.name || ""));
    });

    const attachmentsByMessage = new Map();
    for (const attachment of attachments) {
      if (!attachment.messageId) {
        continue;
      }
      const group = attachmentsByMessage.get(attachment.messageId) || [];
      group.push(attachment);
      attachmentsByMessage.set(attachment.messageId, group);
    }

    for (const message of messages) {
      message.attachments = attachmentsByMessage.get(message.id) || [];
    }

    return {
      conversation,
      messages,
      attachments
    };
  }

  async function getStats() {
    const conversations = await listConversations();
    let messageCount = 0;
    let attachmentCount = 0;

    const db = await openDb();
    const transaction = db.transaction([STORES.messages, STORES.attachments], "readonly");
    const countRequest = transaction.objectStore(STORES.messages).count();
    const attachmentCountRequest = transaction.objectStore(STORES.attachments).count();
    messageCount = await requestToPromise(countRequest);
    attachmentCount = await requestToPromise(attachmentCountRequest);

    return {
      conversationCount: conversations.length,
      messageCount,
      attachmentCount,
      latestBackupAt: conversations[0]?.lastBackupAt || null
    };
  }

  async function updateConversation(conversationId, patch) {
    await tx(STORES.conversations, "readwrite", (store) => {
      const request = store.get(conversationId);

      request.onsuccess = () => {
        const existing = request.result;
        if (!existing) {
          return;
        }

        store.put({
          ...existing,
          ...patch,
          updatedAt: nowIso()
        });
      };
    });
  }

  async function deleteConversation(conversationId) {
    await tx([STORES.conversations, STORES.messages, STORES.attachments], "readwrite", ([conversationStore, messageStore, attachmentStore]) => {
      conversationStore.delete(conversationId);
      const index = messageStore.index("conversationId");
      const cursorRequest = index.openCursor(conversationId);
      const attachmentIndex = attachmentStore.index("conversationId");
      const attachmentCursorRequest = attachmentIndex.openCursor(conversationId);

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          return;
        }
        cursor.delete();
        cursor.continue();
      };

      attachmentCursorRequest.onsuccess = () => {
        const cursor = attachmentCursorRequest.result;
        if (!cursor) {
          return;
        }
        cursor.delete();
        cursor.continue();
      };
    });
  }

  async function clearAll() {
    await tx([STORES.conversations, STORES.messages, STORES.attachments], "readwrite", ([conversationStore, messageStore, attachmentStore]) => {
      conversationStore.clear();
      messageStore.clear();
      attachmentStore.clear();
    });
  }

  async function getAllData() {
    const conversations = await listConversations();
    const result = [];

    for (const conversation of conversations) {
      const item = await getConversation(conversation.id);
      result.push(item);
    }

    return {
      exportedAt: nowIso(),
      app: "ChatGPT Local Backup",
      version: 2,
      conversations: result
    };
  }

  global.ChatBackupDB = {
    clearAll,
    deleteConversation,
    getAllData,
    getConversation,
    getStats,
    listConversations,
    saveSnapshot,
    sha256,
    updateConversation
  };
})(globalThis);
