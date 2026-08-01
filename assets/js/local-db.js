(() => {
  "use strict";

  const DB_NAME = "yousefAutoPartsLocalV2";
  const DB_VERSION = 1;
  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "key" });
        if (!db.objectStoreNames.contains("queue")) {
          const queue = db.createObjectStore("queue", { keyPath: "id" });
          queue.createIndex("status", "status", { unique: false });
          queue.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function transaction(storeName, mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = callback(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("تم إلغاء العملية المحلية"));
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const LocalDB = {
    async setCache(key, value) {
      const record = { key, value, updatedAt: new Date().toISOString() };
      await transaction("cache", "readwrite", (store) => store.put(record));
      return record;
    },
    async getCache(key, fallback = null) {
      const db = await openDb();
      const tx = db.transaction("cache", "readonly");
      const result = await requestToPromise(tx.objectStore("cache").get(key));
      return result ? result.value : fallback;
    },
    async clearCache() {
      await transaction("cache", "readwrite", (store) => store.clear());
    },
    async enqueue(type, payload, label = "") {
      const item = {
        id: crypto.randomUUID(),
        type,
        payload,
        label,
        status: "pending",
        retries: 0,
        lastError: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await transaction("queue", "readwrite", (store) => store.put(item));
      return item;
    },
    async listQueue(statuses = ["pending", "failed"]) {
      const db = await openDb();
      const tx = db.transaction("queue", "readonly");
      const all = await requestToPromise(tx.objectStore("queue").getAll());
      return all.filter((item) => statuses.includes(item.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async updateQueue(id, patch) {
      const db = await openDb();
      const tx = db.transaction("queue", "readwrite");
      const store = tx.objectStore("queue");
      const current = await requestToPromise(store.get(id));
      if (!current) return null;
      const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await requestToPromise(store.put(updated));
      return updated;
    },
    async removeQueue(id) {
      await transaction("queue", "readwrite", (store) => store.delete(id));
    },
    async queueCount() {
      const items = await this.listQueue(["pending", "failed", "processing"]);
      return items.length;
    },
    async setMeta(key, value) {
      await transaction("meta", "readwrite", (store) => store.put({ key, value }));
    },
    async getMeta(key, fallback = null) {
      const db = await openDb();
      const tx = db.transaction("meta", "readonly");
      const result = await requestToPromise(tx.objectStore("meta").get(key));
      return result ? result.value : fallback;
    }
  };

  window.LocalDB = LocalDB;
})();
