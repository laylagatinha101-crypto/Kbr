import { openDB, DBSchema } from 'idb';
import { SongProject } from '../types';

interface KaraokeDB extends DBSchema {
  projects: {
    key: string;
    value: SongProject;
  };
  audioBlobs: {
    key: string;
    value: Blob;
  };
  settings: {
    key: string;
    value: any;
  };
}

const DB_NAME = 'karaoke-br-player';
const DB_VERSION = 2;

let dbPromise: any = null;

async function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<KaraokeDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion) {
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('audioBlobs')) {
          db.createObjectStore('audioBlobs');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
}

export const dbService = {
  async saveProject(project: SongProject): Promise<void> {
    const db = await getDB();
    await db.put('projects', project);
  },

  async saveProjectWithBlobs(project: SongProject, audioBlob?: Blob, vocalsBlob?: Blob): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['projects', 'audioBlobs'], 'readwrite');
    
    try {
      if (audioBlob && project.audioBlobId) {
        await tx.objectStore('audioBlobs').put(audioBlob, project.audioBlobId);
      }
      if (vocalsBlob && project.vocalsBlobId) {
        await tx.objectStore('audioBlobs').put(vocalsBlob, project.vocalsBlobId);
      }
      await tx.objectStore('projects').put(project);
      await tx.done;
    } catch (err: any) {
      tx.abort();
      if (err.name === 'QuotaExceededError') {
        throw new Error("Armazenamento insuficiente. Limpe alguns projetos antigos para salvar novos (QuotaExceededError).");
      }
      throw err;
    }
  },

  async getProject(id: string): Promise<SongProject | undefined> {
    const db = await getDB();
    return db.get('projects', id);
  },

  async getAllProjects(): Promise<SongProject[]> {
    const db = await getDB();
    return db.getAll('projects');
  },

  async deleteProject(id: string): Promise<void> {
    const db = await getDB();
    const project = await db.get('projects', id);
    const tx = db.transaction(['projects', 'audioBlobs'], 'readwrite');
    
    if (project) {
      if (project.audioBlobId) {
        tx.objectStore('audioBlobs').delete(project.audioBlobId);
      }
      if (project.vocalsBlobId) {
        tx.objectStore('audioBlobs').delete(project.vocalsBlobId);
      }
      tx.objectStore('projects').delete(id);
    }
    await tx.done;
  },

  async saveAudioBlob(id: string, blob: Blob): Promise<void> {
    const db = await getDB();
    try {
      await db.put('audioBlobs', blob, id);
    } catch (err: any) {
      if (err.name === 'QuotaExceededError') {
        throw new Error("Armazenamento insuficiente (QuotaExceededError).");
      }
      throw err;
    }
  },

  async getAudioBlob(id: string): Promise<Blob | undefined> {
    const db = await getDB();
    return db.get('audioBlobs', id);
  },

  async saveSetting(key: string, value: any): Promise<void> {
    const db = await getDB();
    await db.put('settings', value, key);
  },

  async getSetting<T>(key: string): Promise<T | undefined> {
    const db = await getDB();
    return db.get('settings', key) as Promise<T | undefined>;
  }
};
