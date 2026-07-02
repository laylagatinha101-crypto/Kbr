import { dbService } from "../lib/db";
import { SongProject } from "../types";

export const projectStorage = {
  async saveProject(project: SongProject, audioBlob?: Blob, vocalsBlob?: Blob): Promise<void> {
    await dbService.saveProject(project);
    if (audioBlob && project.audioBlobId) {
      await dbService.saveAudioBlob(project.audioBlobId, audioBlob);
    }
    if (vocalsBlob && project.vocalsBlobId) {
      await dbService.saveAudioBlob(project.vocalsBlobId, vocalsBlob);
    }
  },

  async getProject(id: string): Promise<SongProject | undefined> {
    return dbService.getProject(id);
  },

  async getAllProjects(): Promise<SongProject[]> {
    return dbService.getAllProjects();
  },

  async deleteProject(id: string, audioBlobId?: string, vocalsBlobId?: string[]): Promise<void> {
    await dbService.deleteProject(id);
    // Audio blobs are handled inside dbService.deleteProject currently
  },

  async getAudioBlob(id: string): Promise<Blob | undefined> {
    return dbService.getAudioBlob(id);
  }
};
