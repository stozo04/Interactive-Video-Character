import { CharacterProfile } from '../types';

const DB_NAME = 'GeminiInteractiveCharacterDB';
const STORE_NAME = 'characters';
const DB_VERSION = 2; // Incremented version to trigger onupgradeneeded

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
            // Clean up old store if it exists
            if (db.objectStoreNames.contains('videoCache')) {
                db.deleteObjectStore('videoCache');
            }
            // Create new store
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

export const getCharacters = async (): Promise<CharacterProfile[]> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result || []);
        });
    } catch (error) {
        console.error("Failed to get characters:", error);
        return []; // Return empty array on failure
    }
};

export const saveCharacter = async (character: CharacterProfile): Promise<void> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(character);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    } catch (error) {
        console.error("Failed to save character:", error);
    }
};

export const deleteCharacter = async (id: string): Promise<void> => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    } catch (error) {
        console.error("Failed to delete character:", error);
    }
};
