import { SongProject, SongLine } from "../types";

export const exportService = {
  downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  exportJson(project: SongProject) {
    const projectToExport = { ...project };
    delete (projectToExport as any).audioUrl;
    
    const blob = new Blob([JSON.stringify(projectToExport, null, 2)], { type: "application/json" });
    this.downloadBlob(blob, `${project.metadata.artist} - ${project.metadata.title}.json`);
  },

  exportMarkdown(project: SongProject) {
    const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = (seconds % 60).toFixed(2).padStart(5, "0");
      return `[${m.toString().padStart(2, "0")}:${s}]`;
    };

    let md = `# Karaokê BR Multilayer\n\n`;
    
    const syncSourceStr = project.syncGranularity === "word" ? "Enhanced LRC" : (project.syncGranularity === "segment" ? "Segmentos estimados" : "LRCLIB (Line)");
    md += `> Fonte de sincronia: ${syncSourceStr}\n`;
    md += `> Qualidade da sincronia: ${project.syncQuality || "good"}\n`;
    md += `> Offset aplicado: ${(project.syncOffset || 0).toFixed(2)}s\n`;
    md += `\n`;

    md += `## Música — ${project.metadata.artist}\n`;
    md += `**Título:** ${project.metadata.title}\n\n`;
    md += `### Camadas\n\n`;

    project.lines.forEach(line => {
      md += `**Tempo:** ${formatTime(line.start)} - ${formatTime(line.end)}\n`;
      md += `**Original:** ${line.original}\n`;
      if (line.ipa) md += `**IPA/AFI:** ${line.ipa}\n`;
      if (line.translationPt) md += `**Tradução:** ${line.translationPt}\n`;
      if (line.pfc) md += `**Karaokê BR/PFC:** ${line.pfc}\n`;
      if (line.tip) md += `*Dica:* ${line.tip}\n`;
      md += `\n---\n\n`;
    });

    const blob = new Blob([md], { type: "text/markdown" });
    this.downloadBlob(blob, `${project.metadata.artist} - ${project.metadata.title}.md`);
  }
};

export function hasStudyData(lines: SongLine[]): boolean {
  return lines.some(line => Boolean(line.study) || Boolean(line.tokens?.some(token => token.study)));
}
