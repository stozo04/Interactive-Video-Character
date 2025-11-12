const DB_NAME = 'GeminiInteractiveCharacterDB';
const STORE_NAME = 'videoCache';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

const initDB = (): Promise<IDBDatabase> => {
    if (dbPromise) {
        return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error("IndexedDB error:", request.error);
            reject(new Error("Failed to open IndexedDB."));
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
    return dbPromise;
};

export const hashImage = async (base64: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(base64);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Convert buffer to hex string
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
};


export const getVideoCache = async (hash: string): Promise<Blob[] | null> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(hash);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                // request.result can be undefined if not found, which is fine.
                resolve(request.result || null);
            };
        });
    } catch(error) {
        console.error("Failed to get video cache:", error);
        return null; // Don't block the app if caching fails
    }
};

export const setVideoCache = async (hash: string, blobs: Blob[]): Promise<void> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(blobs, hash);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve();
            };
        });
    } catch (error) {
        console.error("Failed to set video cache:", error);
        // Don't block the app if caching fails
    }
};
