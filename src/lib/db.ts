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

async function getDB() {
  return openDB<KaraokeDB>(DB_NAME, DB_VERSION, {
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

export const dbService = {
  async saveProject(project: SongProject): Promise<void> {
    const db = await getDB();
    await db.put('projects', project);
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
    if (project && project.audioBlobId) {
      await db.delete('audioBlobs', project.audioBlobId);
    }
    await db.delete('projects', id);
  },

  async saveAudioBlob(id: string, blob: Blob): Promise<void> {
    const db = await getDB();
    await db.put('audioBlobs', blob, id);
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
