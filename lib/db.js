import { normalizePromptText } from "./utils.js";

const DB_NAME = "forgePromptManager";
const DB_VERSION = 2;
const PROMPTS_STORE = "prompts";
const THUMBNAILS_STORE = "thumbnails";
const SETTINGS_STORE = "settings";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(PROMPTS_STORE)) {
        const store = db.createObjectStore(PROMPTS_STORE, { keyPath: "id" });
        store.createIndex("key", "key", { unique: true });
        store.createIndex("updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(THUMBNAILS_STORE)) {
        db.createObjectStore(THUMBNAILS_STORE, { keyPath: "imageId" });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export function makePromptKey(positive, negative) {
  const normPositive = normalizePromptText(positive);
  const normNegative = normalizePromptText(negative);
  return `${normPositive}\u0000${normNegative}`;
}

function normalizePromptPair(positive, negative) {
  return {
    positive: normalizePromptText(positive),
    negative: normalizePromptText(negative),
  };
}

export function splitPromptKey(key) {
  const index = key.indexOf("\u0000");
  if (index === -1) {
    return { positive: key, negative: "" };
  }
  return {
    positive: key.slice(0, index),
    negative: key.slice(index + 1),
  };
}

function createEmptyImageRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    fileName: "",
    thumbnailId: "",
    addedAt: Date.now(),
    metadata: {
      steps: "",
      sampler: "",
      scheduleType: "",
      cfgScale: "",
      seed: "",
      size: "",
      modelHash: "",
      model: "",
      loraHashes: "",
      version: "",
      rawParameters: "",
    },
    ...overrides,
  };
}

function createPromptRecord(positive, negative, images = []) {
  const { positive: normPositive, negative: normNegative } = normalizePromptPair(positive, negative);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    key: makePromptKey(normPositive, normNegative),
    positive: normPositive,
    negative: normNegative,
    note: "",
    images,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeImage(image, promptCreatedAt) {
  return {
    ...image,
    addedAt: image.addedAt ?? promptCreatedAt ?? Date.now(),
  };
}

function normalizePrompt(prompt) {
  const createdAt = prompt.createdAt ?? prompt.updatedAt ?? Date.now();
  return {
    ...prompt,
    createdAt,
    updatedAt: prompt.updatedAt ?? createdAt,
    note: typeof prompt.note === "string" ? prompt.note : "",
    images: Array.isArray(prompt.images)
      ? prompt.images.map((image) => normalizeImage(image, createdAt))
      : [],
  };
}

export async function getAllPrompts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROMPTS_STORE, "readonly");
    const store = tx.objectStore(PROMPTS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const items = request.result
        .map(normalizePrompt)
        .sort((a, b) => b.createdAt - a.createdAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPromptByKey(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROMPTS_STORE, "readonly");
    const store = tx.objectStore(PROMPTS_STORE);
    const index = store.index("key");
    const request = index.get(key);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function upsertPromptPair(positive, negative) {
  const key = makePromptKey(positive, negative);
  const existing = await getPromptByKey(key);

  if (existing) {
    return normalizePrompt(existing);
  }

  const created = createPromptRecord(positive, negative);
  await savePrompt(created);
  return created;
}

export async function savePrompt(prompt, { touchUpdatedAt = false } = {}) {
  const db = await openDb();
  const normalized = normalizePrompt(prompt);
  const toSave = touchUpdatedAt
    ? { ...normalized, updatedAt: Date.now() }
    : normalized;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROMPTS_STORE, "readwrite");
    tx.objectStore(PROMPTS_STORE).put(toSave);
    tx.oncomplete = () => resolve(toSave);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updatePromptNote(promptId, note) {
  const prompts = await getAllPrompts();
  const prompt = prompts.find((item) => item.id === promptId);
  if (!prompt) return null;

  prompt.note = note;
  await savePrompt(prompt);
  return prompt;
}

export async function deletePrompt(promptId) {
  const db = await openDb();
  const prompts = await getAllPrompts();
  const prompt = prompts.find((item) => item.id === promptId);
  if (!prompt) return;

  for (const image of prompt.images) {
    if (image.thumbnailId) {
      await deleteThumbnail(image.thumbnailId);
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROMPTS_STORE, "readwrite");
    tx.objectStore(PROMPTS_STORE).delete(promptId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function addImageToPromptByPair(positive, negative, imageData) {
  const key = makePromptKey(positive, negative);
  let prompt = await getPromptByKey(key);

  if (prompt) {
    prompt = normalizePrompt(prompt);
  } else {
    prompt = createPromptRecord(positive, negative);
  }

  const image = createEmptyImageRecord(imageData);
  prompt.images.push(image);
  await savePrompt(prompt);
  return { prompt, image };
}

export async function deleteImageFromPrompt(promptId, imageId) {
  const db = await openDb();
  const prompts = await getAllPrompts();
  const prompt = prompts.find((item) => item.id === promptId);
  if (!prompt) return null;

  const image = prompt.images.find((item) => item.id === imageId);
  prompt.images = prompt.images.filter((item) => item.id !== imageId);

  if (image?.thumbnailId) {
    await deleteThumbnail(image.thumbnailId);
  }

  await savePrompt(prompt);
  return prompt;
}

export async function deleteAllImagesFromPrompt(promptId) {
  const db = await openDb();
  const prompts = await getAllPrompts();
  const prompt = prompts.find((item) => item.id === promptId);
  if (!prompt) return null;

  for (const image of prompt.images) {
    if (image.thumbnailId) {
      await deleteThumbnail(image.thumbnailId);
    }
  }

  prompt.images = [];
  await savePrompt(prompt);
  return prompt;
}

export async function saveThumbnail(imageId, dataUrl) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBNAILS_STORE, "readwrite");
    tx.objectStore(THUMBNAILS_STORE).put({ imageId, dataUrl });
    tx.oncomplete = () => resolve(imageId);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getThumbnail(imageId) {
  if (!imageId) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBNAILS_STORE, "readonly");
    const request = tx.objectStore(THUMBNAILS_STORE).get(imageId);
    request.onsuccess = () => resolve(request.result?.dataUrl ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteThumbnail(imageId) {
  if (!imageId) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBNAILS_STORE, "readwrite");
    tx.objectStore(THUMBNAILS_STORE).delete(imageId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportAllData() {
  const prompts = await getAllPrompts();
  const thumbnails = {};
  for (const prompt of prompts) {
    for (const image of prompt.images) {
      if (image.thumbnailId) {
        const dataUrl = await getThumbnail(image.thumbnailId);
        if (dataUrl) {
          thumbnails[image.thumbnailId] = dataUrl;
        }
      }
    }
  }

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    prompts,
    thumbnails,
  };
}
export async function importAllData(payload) {
  if (!payload || !Array.isArray(payload.prompts)) {
    throw new Error("Invalid import file format");
  }

  const db = await openDb();
  const storeNames = [PROMPTS_STORE, THUMBNAILS_STORE, SETTINGS_STORE];

  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    tx.objectStore(PROMPTS_STORE).clear();
    tx.objectStore(THUMBNAILS_STORE).clear();
    tx.objectStore(SETTINGS_STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });

  for (const prompt of payload.prompts) {
    await savePrompt(prompt);
  }

  const thumbnails = payload.thumbnails ?? {};  for (const [imageId, dataUrl] of Object.entries(thumbnails)) {
    await saveThumbnail(imageId, dataUrl);
  }
}

export async function estimateStorageUsage() {
  const db = await openDb();

  function sumStoreJson(storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.openCursor();
      let bytes = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(bytes);
          return;
        }
        bytes += new Blob([JSON.stringify(cursor.value)]).size;
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  function sumThumbnailBytes() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THUMBNAILS_STORE, "readonly");
      const store = tx.objectStore(THUMBNAILS_STORE);
      const request = store.openCursor();
      let bytes = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(bytes);
          return;
        }
        const dataUrl = cursor.value?.dataUrl ?? "";
        bytes += new Blob([dataUrl]).size;
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  const [promptsBytes, thumbnailsBytes] = await Promise.all([
    sumStoreJson(PROMPTS_STORE),
    sumThumbnailBytes(),
  ]);

  return {
    totalBytes: promptsBytes + thumbnailsBytes,
    promptsBytes,
    thumbnailsBytes,
  };
}
export async function clearAllData() {
  const db = await openDb();
  const storeNames = [PROMPTS_STORE, THUMBNAILS_STORE, SETTINGS_STORE];

  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, "readwrite");
    tx.objectStore(PROMPTS_STORE).clear();
    tx.objectStore(THUMBNAILS_STORE).clear();
    tx.objectStore(SETTINGS_STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
export { createEmptyImageRecord };
