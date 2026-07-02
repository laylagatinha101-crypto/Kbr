import JSZip from "jszip";
import { projectStorage } from "./projectStorage";
import { SongProject } from "../types";

export interface ZipImportError {
  folder: string;
  reason: string;
}

export interface ZipImportResult {
  imported: number;
  skipped: number;
  errors: ZipImportError[];
}

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".flac", ".webm", ".ogg", ".aac"];

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3": return "audio/mpeg";
    case "m4a": return "audio/mp4";
    case "wav": return "audio/wav";
    case "flac": return "audio/flac";
    case "webm": return "audio/webm";
    case "ogg": return "audio/ogg";
    case "aac": return "audio/aac";
    default: return "application/octet-stream";
  }
}

function generateId(project: Partial<SongProject>, folderName: string): string {
  if (project.id) return project.id;
  const title = project.metadata?.title || folderName;
  const artist = project.metadata?.artist || "Unknown";
  return btoa(encodeURIComponent(`${artist}-${title}`)).replace(/[/+=]/g, "");
}

export async function importLibraryZip(
  file: File, 
  onProgress?: (current: number, total: number) => void
): Promise<ZipImportResult> {
  const result: ZipImportResult = {
    imported: 0,
    skipped: 0,
    errors: []
  };

  try {
    const zip = await JSZip.loadAsync(file);
    
    // Find all project.json files
    const projectFiles: JSZip.JSZipObject[] = [];
    zip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir && relativePath.endsWith("project.json")) {
        // Exclude __MACOSX or hidden files
        if (!relativePath.includes("__MACOSX") && !relativePath.includes("/.")) {
          projectFiles.push(zipEntry);
        }
      }
    });

    if (projectFiles.length === 0) {
      result.errors.push({ folder: "Geral", reason: "O ZIP está vazio ou não contém arquivos project.json." });
      return result;
    }

    if (projectFiles.length > 100) {
      result.errors.push({ folder: "Geral", reason: "O ZIP excede o limite de 100 projetos." });
      return result;
    }

    const total = projectFiles.length;
    let current = 0;

    for (const projectFile of projectFiles) {
      current++;
      const folderPath = projectFile.name.substring(0, projectFile.name.lastIndexOf("/") + 1);
      const folderName = folderPath.replace(/\/$/, "").split("/").pop() || "Raiz";
      
      try {
        const jsonContent = await projectFile.async("string");
        const projectData = JSON.parse(jsonContent) as Partial<SongProject>;

        // Validations
        if (!projectData.metadata) {
           projectData.metadata = { title: folderName, artist: "Artista desconhecido", sourceType: "manual" };
        }
        if (!projectData.metadata.title) projectData.metadata.title = folderName;
        if (!projectData.metadata.artist) projectData.metadata.artist = "Artista desconhecido";
        
        if (!projectData.lines || !Array.isArray(projectData.lines) || projectData.lines.length === 0) {
          result.errors.push({ folder: folderName, reason: "project.json não possui linhas (array vazio ou inválido)." });
          continue;
        }

        // Minimal validation of lines to avoid crashing player
        let invalidLines = false;
        for (const line of projectData.lines) {
          if (typeof line.start !== 'number' || isNaN(line.start)) {
             invalidLines = true;
             break;
          }
        }
        if (invalidLines) {
           result.errors.push({ folder: folderName, reason: "Algumas linhas não possuem 'start' (tempo) numérico válido." });
           continue;
        }

        const id = generateId(projectData, folderName);
        projectData.id = id;
        if (!projectData.createdAt) projectData.createdAt = new Date().toISOString();
        projectData.updatedAt = new Date().toISOString();

        // Find main audio
        let mainAudioFile: JSZip.JSZipObject | undefined;
        let vocalsFile: JSZip.JSZipObject | undefined;
        
        const folderFiles = Object.keys(zip.files).filter(path => 
          path.startsWith(folderPath) && 
          path !== folderPath && 
          !path.substring(folderPath.length).includes("/") && // directly in this folder
          !path.includes("__MACOSX") &&
          !path.includes("/.")
        );

        // Search for audio.* or anything with an audio extension
        const audioCandidates = folderFiles.filter(path => 
          AUDIO_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext))
        );

        const mainAudioPath = audioCandidates.find(p => p.substring(folderPath.length).toLowerCase().startsWith("audio.")) || audioCandidates[0];
        if (mainAudioPath) {
            mainAudioFile = zip.files[mainAudioPath];
        }

        const vocalsPath = audioCandidates.find(p => p.substring(folderPath.length).toLowerCase().startsWith("vocals."));
        if (vocalsPath) {
            vocalsFile = zip.files[vocalsPath];
        }

        if (!mainAudioFile) {
          result.errors.push({ folder: folderName, reason: "Arquivo de áudio principal não encontrado." });
          continue;
        }

        const audioBlobData = await mainAudioFile.async("blob");
        if (audioBlobData.size === 0) {
          result.errors.push({ folder: folderName, reason: "O arquivo de áudio principal está vazio (0 bytes)." });
          continue;
        }

        const audioMimeType = getMimeType(mainAudioFile.name);
        const audioBlob = new Blob([audioBlobData], { type: audioMimeType });
        
        projectData.audioBlobId = `audio_${id}`;
        
        let vocalsBlob: Blob | undefined;
        if (vocalsFile) {
          const vocalsBlobData = await vocalsFile.async("blob");
          if (vocalsBlobData.size > 0) {
            const vocalsMimeType = getMimeType(vocalsFile.name);
            vocalsBlob = new Blob([vocalsBlobData], { type: vocalsMimeType });
            projectData.vocalsBlobId = `vocals_${id}`;
          }
        }

        // Save
        await projectStorage.saveProject(projectData as SongProject, audioBlob, vocalsBlob);
        result.imported++;

      } catch (err: any) {
        console.error("Error importing project in folder", folderPath, err);
        const reason = err.name === 'QuotaExceededError' 
            ? "Armazenamento insuficiente no navegador (Quota excedida)."
            : "Erro ao processar JSON ou arquivos internos.";
        result.errors.push({ folder: folderName, reason });
      }

      if (onProgress) {
        onProgress(current, total);
      }
    }

  } catch (err) {
    console.error("Error unzipping file", err);
    result.errors.push({ folder: "Arquivo ZIP", reason: "Não foi possível abrir o arquivo ZIP" });
  }

  return result;
}
