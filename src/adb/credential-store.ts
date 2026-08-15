import type { AdbCredentialStore, AdbPrivateKey } from '@yume-chan/adb';

interface KeyRecord {
  id?: number;
  privateKey: ArrayBuffer;
}

function openDatabase(appName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`mobile-web-devtools-adb-${appName}`, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('keys')) {
        database.createObjectStore('keys', {
          keyPath: 'id',
          autoIncrement: true,
        });
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error('无法打开 ADB 密钥数据库'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function savePrivateKey(
  appName: string,
  privateKey: Uint8Array,
): Promise<void> {
  const database = await openDatabase(appName);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readwrite');
      const store = transaction.objectStore('keys');
      store.put({ privateKey: privateKey.slice().buffer } satisfies KeyRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('保存 ADB 密钥失败'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('保存 ADB 密钥失败'));
    });
  } finally {
    database.close();
  }
}

async function readPrivateKeys(appName: string): Promise<Uint8Array[]> {
  const database = await openDatabase(appName);
  try {
    return await new Promise<Uint8Array[]>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readonly');
      const request = transaction.objectStore('keys').getAll();
      request.onerror = () =>
        reject(request.error ?? new Error('读取 ADB 密钥失败'));
      request.onsuccess = () => {
        const keys = (request.result as KeyRecord[])
          .map((record) => new Uint8Array(record.privateKey))
          .filter((key) => key.byteLength > 0);
        resolve(keys);
      };
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('读取 ADB 密钥失败'));
    });
  } finally {
    database.close();
  }
}

/**
 * AdbCredentialStore backed by WebCrypto + IndexedDB. The first Android
 * connection shows the device-side “Allow USB debugging” authorization prompt.
 */
export class AdbWebCredentialStore implements AdbCredentialStore {
  readonly #appName: string;
  readonly #keyName: string;

  constructor(appName = 'mobile-web-devtools') {
    this.#appName = appName;
    this.#keyName = `${appName}@${globalThis.location?.hostname ?? 'localhost'}`;
  }

  async generateKey(): Promise<AdbPrivateKey> {
    const { privateKey } = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-1',
      },
      true,
      ['sign', 'verify'],
    );
    const buffer = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', privateKey),
    );
    await savePrivateKey(this.#appName, buffer);
    return { buffer, name: this.#keyName };
  }

  async *iterateKeys(): AsyncGenerator<AdbPrivateKey, void, void> {
    for (const buffer of await readPrivateKeys(this.#appName)) {
      yield { buffer, name: this.#keyName };
    }
  }
}
