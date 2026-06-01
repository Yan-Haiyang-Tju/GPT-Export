(function attachBackupDb(global) {
  "use strict";

  const DB_NAME = "chatgpt-local-backup";
  const DB_VERSION = 1;
  const STORES = {
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
    const normalizedMessages = [];

    for (const message of messages) {
      const role = message.role || "unknown";
      const index = Number.isFinite(message.index) ? message.index : normalizedMessages.length;
      const content = String(message.content || "").trim();

      if (!content) {
        continue;
      }

      const contentHash = await sha256(`${role}\n${content}`);
      normalizedMessages.push({
        id: stableMessageId(conversationId, index, role),
        conversationId,
        role,
        content,
        contentHash,
        index,
        status: message.status || "complete",
        createdAt: message.createdAt || backupTime,
        updatedAt: backupTime
      });
    }

    let savedMessages = 0;
    let changedMessages = 0;

    await tx([STORES.conversations, STORES.messages], "readwrite", ([conversationStore, messageStore]) => {
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
    });

    return {
      conversationId,
      savedMessages,
      changedMessages,
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
    const transaction = db.transaction([STORES.conversations, STORES.messages], "readonly");
    const conversation = await requestToPromise(
      transaction.objectStore(STORES.conversations).get(conversationId)
    );
    const index = transaction.objectStore(STORES.messages).index("conversationId");
    const messages = await requestToPromise(index.getAll(conversationId));

    messages.sort((a, b) => a.index - b.index);

    return {
      conversation,
      messages
    };
  }

  async function getStats() {
    const conversations = await listConversations();
    let messageCount = 0;

    const db = await openDb();
    const transaction = db.transaction(STORES.messages, "readonly");
    const countRequest = transaction.objectStore(STORES.messages).count();
    messageCount = await requestToPromise(countRequest);

    return {
      conversationCount: conversations.length,
      messageCount,
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
    await tx([STORES.conversations, STORES.messages], "readwrite", ([conversationStore, messageStore]) => {
      conversationStore.delete(conversationId);
      const index = messageStore.index("conversationId");
      const cursorRequest = index.openCursor(conversationId);

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          return;
        }
        cursor.delete();
        cursor.continue();
      };
    });
  }

  async function clearAll() {
    await tx([STORES.conversations, STORES.messages], "readwrite", ([conversationStore, messageStore]) => {
      conversationStore.clear();
      messageStore.clear();
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
      version: 1,
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
