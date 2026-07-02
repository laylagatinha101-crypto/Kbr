import { dbService } from "../lib/db";
import { SongProject } from "../types";

export const projectStorage = {
  async saveProject(project: SongProject, audioBlob?: Blob, vocalsBlob?: Blob): Promise<void> {
    if (audioBlob || vocalsBlob) {
      await dbService.saveProjectWithBlobs(project, audioBlob, vocalsBlob);
    } else {
      await dbService.saveProject(project);
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
