import React, { useState, useEffect, useRef } from 'react';
import { Upload, Music, FileJson, Trash2, Play, Search, AlertCircle, FileArchive, Loader2, CheckCircle2, Mic, Star, Plus, ListMusic, X, Clock, Trophy, ArrowRight, RotateCcw } from 'lucide-react';
import { dbService } from '../lib/db';
import { SongProject } from '../types';
import { importLibraryZip, ZipImportResult } from '../services/zipImportService';
import { useUserProgress } from '../hooks/useUserProgress';

// Helper to format song duration in MM:SS
function getSongDuration(proj: SongProject): string {
  let seconds = proj.metadata?.duration;
  if (!seconds || seconds <= 0) {
    if (proj.lines && proj.lines.length > 0) {
      seconds = proj.lines[proj.lines.length - 1].end;
    }
  }
  if (!seconds || seconds <= 0) return "--:--";
  
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
}

// Helper to get the highest pronunciation score for a song
function getProjectHighScore(proj: SongProject): number | null {
  const scores = proj.progress?.practiceScores;
  if (!scores) return null;
  let maxScore = -1;
  for (const key in scores) {
    const lineScores = scores[key];
    if (lineScores && lineScores.length > 0) {
      const highestForLine = Math.max(...lineScores);
      if (highestForLine > maxScore) {
        maxScore = highestForLine;
      }
    }
  }
  return maxScore >= 0 ? maxScore : null;
}

// Helper to map songs to their static cover images
function getSongCover(proj: SongProject): string | undefined {
  if (!proj?.metadata) return undefined;
  
  const title = (proj.metadata.title || '').toLowerCase().trim();
  const artist = (proj.metadata.artist || '').toLowerCase().trim();

  // Bruno Mars - It Will Rain
  if (title.includes("it will rain") || (title.includes("rain") && artist.includes("bruno mars"))) {
    return "/covers/it_will_rain.jpg";
  }
  // Billie Eilish - when the party's over
  if (title.includes("when the party's over") || title.includes("when the partys over") || (title.includes("party's over") && artist.includes("billie eilish"))) {
    return "/covers/when_the_partys_over.jpg";
  }
  // Bruno Mars - When I Was Your Man
  if (title.includes("when i was your man") || (title.includes("your man") && artist.includes("bruno mars"))) {
    return "/covers/when_i_was_your_man.jpg";
  }
  // A Great Big World & Christina Aguilera - Say Something
  if (title.includes("say something") || (title.includes("something") && (artist.includes("great big") || artist.includes("christina")))) {
    return "/covers/say_something.jpg";
  }
  // Rihanna - Needed Me
  if (title.includes("needed me") || (title.includes("needed") && artist.includes("rihanna"))) {
    return "/covers/needed_me.jpg";
  }
  // Lady Gaga & Bruno Mars - Die With A Smile
  if (title.includes("die with a smile") || (title.includes("smile") && (artist.includes("gaga") || artist.includes("bruno")))) {
    return "/covers/die_with_a_smile.jpg";
  }

  return proj.metadata.coverUrl || proj.metadata.youtube?.sourceThumbnailUrl;
}

// Helper to calculate study streak (consecutive active days)
function calculateStudyStreak(attempts: { createdAt: string }[]): number {
  if (!attempts || attempts.length === 0) return 0;
  
  const dates = Array.from(new Set(attempts.map(a => a.createdAt.split('T')[0])))
    .map(d => new Date(d))
    .sort((a, b) => b.getTime() - a.getTime());
  
  if (dates.length === 0) return 0;
  
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  const latestDateStr = dates[0].toISOString().split('T')[0];
  
  if (latestDateStr !== todayStr && latestDateStr !== yesterdayStr) {
    return 0;
  }
  
  let streak = 1;
  for (let i = 0; i < dates.length - 1; i++) {
    const diffTime = dates[i].getTime() - dates[i+1].getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      streak += 1;
    } else if (diffDays > 1) {
      break;
    }
  }
  return streak;
}

const SKILL_DISPLAY_NAMES: Record<string, { title: string; subtitle: string; emoji: string }> = {
  "Linking Sounds": { 
    title: "Conexão de Sons", 
    subtitle: "Conexão fluida de consoante-vogal e junções de palavras.", 
    emoji: "🔗" 
  },
  "Reductions": { 
    title: "Reduções de Palavras", 
    subtitle: "Reduções de sílabas e palavras comuns na fala rápida (ex: gonna, wanna).", 
    emoji: "📉" 
  },
  "Silent Letters": { 
    title: "Letras Mudas", 
    subtitle: "Letras escritas mas não pronunciadas na fala natural.", 
    emoji: "🤫" 
  },
  "Glottal Stop": { 
    title: "Pausa Glotal", 
    subtitle: "Pausa rápida de ar na garganta para articular certas consoantes.", 
    emoji: "🛑" 
  },
  "Flap T": { 
    title: "Flap T (Som de 'R')", 
    subtitle: "O som de T suavizado ou transformado em som de R suave entre vogais.", 
    emoji: "👅" 
  },
  "Assimilation": { 
    title: "Assimilação de Sons", 
    subtitle: "Modificações onde um som influencia e altera o som vizinho.", 
    emoji: "🧬" 
  },
  "Elision": { 
    title: "Elisão de Sons", 
    subtitle: "Omissão natural de consoantes ou vogais para maior fluidez.", 
    emoji: "✂️" 
  },
  "Word Stress": { 
    title: "Sílaba Tônica", 
    subtitle: "Ritmo e acentuação de sílabas específicas dentro de palavras complexas.", 
    emoji: "📢" 
  },
  "Sentence Stress": { 
    title: "Ênfase da Frase", 
    subtitle: "Entonação e ênfase nas palavras portadoras de significado da frase.", 
    emoji: "🌊" 
  },
  "Intonation": { 
    title: "Entonação da Voz", 
    subtitle: "Modulações melódicas da voz para expressar emoções ou perguntas.", 
    emoji: "📈" 
  },
  "Vowel Sounds": {
    title: "Sons Vocálicos",
    subtitle: "Diferenciação precisa entre vogais longas, curtas e ditongos.",
    emoji: "🗣️"
  },
  "Consonant Sounds": {
    title: "Sons Consonânticos",
    subtitle: "Aprimoramento da articulação de consoantes difíceis ou exclusivas do idioma.",
    emoji: "🦷"
  },
  "final_consonant": {
    title: "Consoantes Finais",
    subtitle: "Pronúncia nítida de consoantes no fim das palavras, evitando adicionar sons vocálicos extras (como 'e' mudo).",
    emoji: "🔤"
  },
  "Final Consonants": {
    title: "Consoantes Finais",
    subtitle: "Pronúncia nítida de consoantes no fim das palavras, evitando adicionar sons vocálicos extras (como 'e' mudo).",
    emoji: "🔤"
  },
  "Final Consonant": {
    title: "Consoantes Finais",
    subtitle: "Pronúncia nítida de consoantes no fim das palavras, evitando adicionar sons vocálicos extras (como 'e' mudo).",
    emoji: "🔤"
  }
};

interface LibraryScreenProps {
  onOpenProject: (project: SongProject, audioBlob: Blob, initialPracticeLineId?: string) => void;
  queue: SongProject[];
  onAddToQueue: (project: SongProject) => void;
  onRemoveFromQueue: (projectId: string, indexToRemove?: number) => void;
  onClearQueue: () => void;
  onPlayQueue: (startIndex: number) => void;
  onStartSmartReview?: (dueItems: { projectId: string; lineId: string }[]) => void;
}

export function LibraryScreen({ 
  onOpenProject,
  queue,
  onAddToQueue,
  onRemoveFromQueue,
  onClearQueue,
  onPlayQueue,
  onStartSmartReview
}: LibraryScreenProps) {
  const [projects, setProjects] = useState<SongProject[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "favorites">("all");
  const [libraryView, setLibraryView] = useState<"library" | "import" | "study">("library");
  const [pendingJson, setPendingJson] = useState<SongProject | null>(null);
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const { progress } = useUserProgress();
  
  // ZIP Import State
  const [isImportingZip, setIsImportingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState({ current: 0, total: 0 });
  const [zipResult, setZipResult] = useState<ZipImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const all = await dbService.getAllProjects();
      // Sort by updated/created
      all.sort((a, b) => {
        const da = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const db = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return db - da;
      });
      setProjects(all);
    } catch (err) {
      console.error('Failed to load projects', err);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.endsWith('.json')) {
        try {
          const text = await file.text();
          const json = JSON.parse(text) as SongProject;
          if (!json.lines || !json.metadata) {
            throw new Error('JSON inválido. Falta lines ou metadata.');
          }
          setPendingJson(json);
        } catch (err: any) {
          setError(`Erro ao ler JSON: ${err.message}`);
        }
      } else if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|flac)$/i)) {
        setPendingAudio(file);
      } else {
        setError(`Formato de arquivo não suportado: ${file.name}`);
      }
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleZipUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setZipResult(null);
    setIsImportingZip(true);
    setZipProgress({ current: 0, total: 0 });

    try {
      const result = await importLibraryZip(file, (current, total) => {
        setZipProgress({ current, total });
      });
      
      setZipResult(result);
      await loadProjects();
    } catch (err: any) {
      setError(`Erro ao importar ZIP: ${err.message}`);
    } finally {
      setIsImportingZip(false);
      if (zipInputRef.current) {
        zipInputRef.current.value = '';
      }
    }
  };

  const handleSaveAndOpen = async () => {
    if (!pendingJson || !pendingAudio) return;
    try {
      const audioId = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      const newProject: SongProject = {
        ...pendingJson,
        id: pendingJson.id || `proj_${Date.now()}`,
        audioBlobId: audioId,
        updatedAt: new Date().toISOString(),
      };

      await dbService.saveAudioBlob(audioId, pendingAudio);
      await dbService.saveProject(newProject);
      
      onOpenProject(newProject, pendingAudio);
    } catch (err: any) {
      setError(`Erro ao salvar projeto: ${err.message}`);
    }
  };

  const handleOpenExisting = async (proj: SongProject, initialPracticeLineId?: string) => {
    if (!proj.audioBlobId) {
      setError('Áudio não encontrado para este projeto.');
      return;
    }
    try {
      const blob = await dbService.getAudioBlob(proj.audioBlobId);
      if (!blob) {
        setError('Arquivo de áudio não encontrado no banco local. Importe novamente.');
        return;
      }
      onOpenProject(proj, blob, initialPracticeLineId);
    } catch (err: any) {
      setError(`Erro ao abrir: ${err.message}`);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Tem certeza que deseja remover este projeto da biblioteca?')) {
      await dbService.deleteProject(id);
      loadProjects();
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent, proj: SongProject) => {
    e.stopPropagation();
    try {
      const updatedProject: SongProject = {
        ...proj,
        favorite: !proj.favorite,
        updatedAt: new Date().toISOString()
      };
      await dbService.saveProject(updatedProject);
      await loadProjects();
    } catch (err: any) {
      setError(`Erro ao atualizar favoritos: ${err.message}`);
    }
  };

  const clearPending = () => {
    setPendingJson(null);
    setPendingAudio(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 pb-24 md:p-12 font-sans selection:bg-indigo-500/30">
      <div className="max-w-5xl mx-auto space-y-12">
        <header>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight flex items-center gap-3">
            <div className="bg-indigo-600 p-2 md:p-3 rounded-2xl md:rounded-3xl shadow-lg shadow-indigo-500/20">
              <Mic className="w-8 h-8 md:w-10 md:h-10 text-white" />
            </div>
            <span>
              <span className="text-white">Karaokê BR</span>{' '}
              <span className="bg-gradient-to-br from-indigo-400 to-purple-500 bg-clip-text text-transparent">Player</span>
            </span>
          </h1>
          <p className="text-neutral-400 mt-3 md:mt-4 text-base md:text-lg max-w-lg">
            Player offline para projetos processados.
          </p>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Navigation Tabs to separate Library and Import views */}
        <div className="flex gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800 max-w-md">
          <button
            onClick={() => setLibraryView("library")}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
              libraryView === "library"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/15"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
            }`}
          >
            <Music className="w-4 h-4 text-pink-400" />
            🎵 Biblioteca
          </button>
          <button
            onClick={() => setLibraryView("study")}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
              libraryView === "study"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/15"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
            }`}
          >
            <Clock className="w-4 h-4 text-emerald-400" />
            ✍️ Estudo
          </button>
          <button
            onClick={() => setLibraryView("import")}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-2 ${
              libraryView === "import"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/15"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/50"
            }`}
          >
            <Upload className="w-4 h-4 text-indigo-400" />
            📥 Importar
          </button>
        </div>

        {libraryView === "import" ? (
          <section className="bg-neutral-900 border border-neutral-800 rounded-3xl p-5 md:p-8 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 className="text-lg md:text-xl font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-400" /> Importar Projeto
              </h2>
              <label className="cursor-pointer bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center gap-2">
                <FileArchive className="w-4 h-4" />
                Importar ZIP
                <input 
                  type="file" 
                  ref={zipInputRef}
                  accept=".zip,application/zip" 
                  className="hidden" 
                  onChange={handleZipUpload}
                  disabled={isImportingZip}
                />
              </label>
            </div>
            
            {isImportingZip && (
              <div className="mb-6 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center gap-4">
                <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                <div>
                  <p className="font-medium text-indigo-200">Importando biblioteca...</p>
                  <p className="text-sm text-indigo-300">
                    {zipProgress.current} de {zipProgress.total} projetos processados
                  </p>
                </div>
              </div>
            )}

            {zipResult && (
              <div className="mb-6 p-4 bg-neutral-950 border border-neutral-800 rounded-xl">
                <div className="flex items-center gap-2 mb-2 text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">Importação concluída</span>
                </div>
                <p className="text-sm text-neutral-300">
                  {zipResult.imported} projetos importados
                </p>
                <p className="text-sm text-neutral-300 mb-2">
                  {zipResult.errors.length} com erro
                </p>
                
                {zipResult.errors.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-red-400 mb-2">
                      {zipResult.errors.length} projetos não foram importados:
                    </p>
                    <ul className="text-xs text-neutral-400 space-y-1 bg-black/20 p-3 rounded-lg max-h-32 overflow-y-auto">
                      {zipResult.errors.map((err, i) => (
                        <li key={i}>- Pasta {err.folder}: {err.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 md:gap-4 mb-6">
              <div className={`p-4 md:p-6 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 md:gap-3 transition-colors ${pendingJson ? 'border-green-500/30 bg-green-500/5' : 'border-neutral-700 bg-neutral-950/50 hover:border-neutral-500'}`}>
                <FileJson className={`w-6 h-6 md:w-8 md:h-8 ${pendingJson ? 'text-green-400' : 'text-neutral-500'}`} />
                <div className="text-center">
                  <p className="font-medium text-neutral-200 text-sm md:text-base line-clamp-1">
                    {pendingJson ? pendingJson.metadata?.title || 'Projeto Carregado' : 'Arquivo .json'}
                  </p>
                  <p className="text-[10px] md:text-xs text-neutral-500 mt-1">
                    {pendingJson ? `${pendingJson.lines?.length || 0} linhas` : 'Obrigatório'}
                  </p>
                </div>
              </div>
              
              <div className={`p-4 md:p-6 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 md:gap-3 transition-colors ${pendingAudio ? 'border-green-500/30 bg-green-500/5' : 'border-neutral-700 bg-neutral-950/50 hover:border-neutral-500'}`}>
                <Music className={`w-6 h-6 md:w-8 md:h-8 ${pendingAudio ? 'text-green-400' : 'text-neutral-500'}`} />
                <div className="text-center">
                  <p className="font-medium text-neutral-200 text-sm md:text-base line-clamp-1">
                    {pendingAudio ? pendingAudio.name : 'Arquivo de Áudio'}
                  </p>
                  <p className="text-[10px] md:text-xs text-neutral-500 mt-1">
                    {pendingAudio ? 'Carregado' : '(.mp3, .wav)'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
              <label className="cursor-pointer bg-neutral-800 hover:bg-neutral-700 text-white px-6 py-3 rounded-xl font-medium transition-colors w-full sm:w-auto text-center">
                Selecionar Arquivos
                <input 
                  type="file" 
                  ref={fileInputRef}
                  multiple 
                  accept=".json,audio/*,.mp3,.m4a,.wav,.flac" 
                  className="hidden" 
                  onChange={handleFileUpload}
                />
              </label>
              
              <div className="flex gap-3 w-full sm:w-auto">
                {(pendingJson || pendingAudio) && (
                  <button 
                    onClick={clearPending}
                    className="px-6 py-3 rounded-xl font-medium text-neutral-400 hover:text-white transition-colors"
                  >
                    Cancelar
                  </button>
                )}
                
                <button 
                  onClick={handleSaveAndOpen}
                  disabled={!pendingJson || !pendingAudio}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white px-8 py-3 rounded-xl font-medium transition-colors w-full sm:w-auto flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  Salvar e Abrir
                </button>
              </div>
            </div>
          </section>
        ) : libraryView === "study" ? (
          <section className="space-y-8 animate-in fade-in duration-200">
            {/* Header / Intro */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <span className="text-2xl">✍️</span> Central de Estudo
                </h2>
                <p className="text-sm text-neutral-400">Acompanhe seu progresso, revise pendências e domine a pronúncia.</p>
              </div>
            </div>

            {(() => {
              const now = new Date().toISOString();
              const items = progress?.items || [];
              
              // Filter due lines
              const dueItems = items.filter(i => i.dueAt <= now && i.type === 'line');
              
              // Calculate stats
              const masteredItems = items.filter(i => i.status === 'mastered' && i.type === 'line').length;
              const learningItems = items.filter(i => (i.status === 'learning' || i.status === 'review' || i.status === 'new') && i.type === 'line').length;
              
              const totalLinesInLibrary = projects.reduce((acc, p) => acc + (p.lines?.length || 0), 0);
              const newItemsCount = Math.max(0, totalLinesInLibrary - masteredItems - learningItems);

              // Calculate study streak
              const streak = calculateStudyStreak(progress?.attempts || []);
              
              // Calculate average pronunciation score
              const attemptsWithScore = (progress?.attempts || []).filter(a => typeof a.score === 'number' && a.score > 0);
              const avgPronunciation = attemptsWithScore.length > 0
                ? Math.round(attemptsWithScore.reduce((sum, a) => sum + (a.score || 0), 0) / attemptsWithScore.length)
                : 0;

              return (
                <div className="space-y-8">
                  {/* Painel de Métricas e Gamificação (Progresso Real) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Streak Card */}
                    <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400 shrink-0 text-xl font-bold shadow-inner">
                        🔥
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-neutral-400 font-bold">Ofensiva</div>
                        <div className="text-2xl font-black text-white mt-0.5">{streak} {streak === 1 ? 'Dia' : 'Dias'}</div>
                        <div className="text-[10px] text-neutral-500 font-medium">Consistência de estudos</div>
                      </div>
                    </div>

                    {/* Overall Pronunciation Status */}
                    <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0 text-xl font-bold shadow-inner">
                        ✨
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-neutral-400 font-bold">Média de Pronúncia</div>
                        <div className="text-2xl font-black text-white mt-0.5">{avgPronunciation}%</div>
                        <div className="text-[10px] text-neutral-500 font-medium">Precisão nas gravações</div>
                      </div>
                    </div>

                    {/* Mastery Level Counts */}
                    <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl">
                      <div className="text-xs uppercase tracking-wider text-neutral-400 font-bold mb-2">Nível de Maestria</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-neutral-950 px-2 py-1.5 rounded-lg border border-neutral-805">
                          <div className="text-sm font-black text-indigo-400">{newItemsCount}</div>
                          <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">Novas</div>
                        </div>
                        <div className="bg-neutral-950 px-2 py-1.5 rounded-lg border border-neutral-805">
                          <div className="text-sm font-black text-sky-400">{learningItems}</div>
                          <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">Estudo</div>
                        </div>
                        <div className="bg-neutral-950 px-2 py-1.5 rounded-lg border border-neutral-805">
                          <div className="text-sm font-black text-emerald-400">{masteredItems}</div>
                          <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-wider">Domínio</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Smart Review (Sessão de Revisão Unificada) */}
                  <div className="bg-gradient-to-br from-indigo-950/40 to-neutral-900 border border-indigo-500/20 rounded-3xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-2 text-center md:text-left">
                      <h3 className="text-xl font-bold text-white flex items-center justify-center md:justify-start gap-2">
                        <Clock className="w-5 h-5 text-indigo-400" />
                        Sessão Inteligente (Smart Review)
                      </h3>
                      <p className="text-neutral-400 text-sm max-w-xl">
                        {dueItems.length > 0 
                          ? `Você tem ${dueItems.length} ${dueItems.length === 1 ? 'frase pendente' : 'frases pendentes'} para revisar hoje de todas as músicas da biblioteca.`
                          : "Excelente! Você está em dia com todas as suas revisões hoje. Continue praticando para obter novas pontuações."}
                      </p>
                    </div>

                    <div className="shrink-0 w-full md:w-auto flex flex-col sm:flex-row gap-3">
                      {dueItems.length > 0 ? (
                        <button
                          onClick={() => {
                            if (onStartSmartReview) {
                              const queueData = dueItems.map(item => ({
                                projectId: item.projectId,
                                lineId: item.lineId
                              }));
                              onStartSmartReview(queueData);
                            }
                          }}
                          className="w-full sm:w-auto px-6 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 text-base"
                        >
                          <Play className="w-5 h-5 fill-current" />
                          Iniciar Treino Diário
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (onStartSmartReview && items.length > 0) {
                              const randomItems = [...items]
                                .filter(i => i.type === 'line')
                                .sort(() => Math.random() - 0.5)
                                .slice(0, 10)
                                .map(item => ({
                                  projectId: item.projectId,
                                  lineId: item.lineId
                                }));
                              if (randomItems.length > 0) {
                                onStartSmartReview(randomItems);
                              } else {
                                alert("Você precisa praticar músicas no karaokê primeiro para registrar frases para estudo!");
                              }
                            } else {
                              alert("Nenhuma frase registrada no seu progresso ainda. Pratique o Karaokê!");
                            }
                          }}
                          className="w-full sm:w-auto px-6 py-4 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 text-base border border-neutral-700"
                        >
                          <RotateCcw className="w-5 h-5" />
                          Treino Livre (Revisar Recentes)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Skill Focus Deck */}
                  {(() => {
                    const skillMap: Record<string, { projectId: string; lineId: string; songTitle: string }[]> = {};
                    projects.forEach(proj => {
                      proj.lines.forEach(line => {
                        const skills = line.study?.skillFocus || [];
                        skills.forEach(skill => {
                          if (!skillMap[skill]) skillMap[skill] = [];
                          skillMap[skill].push({
                            projectId: proj.id,
                            lineId: line.id,
                            songTitle: proj.metadata.title
                          });
                        });
                      });
                    });

                    const skillEntries = Object.entries(skillMap).sort((a, b) => b[1].length - a[1].length);

                    return (
                      <div className="space-y-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <span>🎯</span> Foco por Habilidades (Skill Focus Deck)
                        </h3>
                        {skillEntries.length === 0 ? (
                          <p className="text-sm text-neutral-500 italic">Nenhuma habilidade fonética mapeada na biblioteca ainda.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {skillEntries.map(([skill, items]) => {
                              const normalizedKey = SKILL_DISPLAY_NAMES[skill] 
                                ? skill 
                                : Object.keys(SKILL_DISPLAY_NAMES).find(
                                    k => k.toLowerCase() === skill.toLowerCase() || 
                                         k.toLowerCase().replace(/[^a-z0-9]/g, '') === skill.toLowerCase().replace(/[^a-z0-9]/g, '')
                                  ) || skill;
                              const skillInfo = SKILL_DISPLAY_NAMES[normalizedKey] || {
                                title: skill,
                                subtitle: "Treino focado de pronúncia e escuta ativa.",
                                emoji: "🎯"
                              };
                              return (
                                <div 
                                  key={skill}
                                  className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl hover:border-neutral-700 transition-all flex flex-col justify-between"
                                >
                                  <div>
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-black uppercase tracking-wider w-fit">
                                        Fonética
                                      </div>
                                      <span className="text-xl">{skillInfo.emoji}</span>
                                    </div>
                                    <h4 className="text-base font-bold text-white mb-1">{skillInfo.title}</h4>
                                    <p className="text-xs text-neutral-400 mb-4 leading-relaxed">{skillInfo.subtitle}</p>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <p className="text-[11px] text-neutral-500 font-medium">
                                      {items.length} {items.length === 1 ? 'linha disponível' : 'linhas disponíveis'}
                                    </p>
                                    <button
                                      onClick={() => {
                                        if (onStartSmartReview) {
                                          onStartSmartReview(items.map(i => ({ projectId: i.projectId, lineId: i.lineId })));
                                        }
                                      }}
                                      className="w-full py-2.5 bg-neutral-950 hover:bg-indigo-600 hover:text-white border border-neutral-800 hover:border-indigo-500 text-neutral-300 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                                    >
                                      <Play className="w-3 h-3 fill-current" />
                                      Treinar Habilidade
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Vocabulary Library ("Meu Dicionário") */}
                  {(() => {
                    const wordAttempts = (progress?.items || []).filter(item => item.type === 'token');
                    const suggestedDictionaryWords: { text: string; pfc?: string; hint?: string; projectId: string; lineId: string; tokenId: string; attempts: number; score?: number }[] = [];
                    
                    projects.forEach(proj => {
                      proj.lines.forEach(line => {
                        const tokens = Array.isArray(line.tokens) ? line.tokens : [];
                        tokens.forEach(tok => {
                          if (tok.study) {
                            const practiced = wordAttempts.find(a => a.projectId === proj.id && a.lineId === line.id && a.tokenId === tok.id);
                            suggestedDictionaryWords.push({
                              text: tok.text || "",
                              pfc: tok.pfc,
                              hint: tok.study.hintPt,
                              projectId: proj.id,
                              lineId: line.id,
                              tokenId: tok.id || "",
                              attempts: practiced?.attempts || 0,
                              score: practiced?.bestScore
                            });
                          }
                        });
                      });
                    });

                    const uniqueWordsMap: Record<string, typeof suggestedDictionaryWords[0]> = {};
                    suggestedDictionaryWords.forEach(w => {
                      const clean = w.text.toLowerCase().trim();
                      if (!clean) return;
                      const existing = uniqueWordsMap[clean];
                      if (!existing || w.attempts > existing.attempts || (w.score && (!existing.score || w.score < existing.score))) {
                        uniqueWordsMap[clean] = w;
                      }
                    });

                    const dictionaryList = Object.values(uniqueWordsMap).sort((a, b) => b.attempts - a.attempts).slice(0, 15);

                    return (
                      <div className="space-y-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <span>📚</span> Meu Dicionário de Pronúncia
                        </h3>
                        <p className="text-xs text-neutral-400">Palavras marcadas com pronúncia complexa nas letras de suas músicas.</p>
                        
                        {dictionaryList.length === 0 ? (
                          <p className="text-sm text-neutral-500 italic">Nenhum termo fonético com dicas disponível na biblioteca ainda.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            {dictionaryList.map((word, i) => (
                              <div 
                                key={i}
                                onClick={() => {
                                  const proj = projects.find(p => p.id === word.projectId);
                                  if (proj) {
                                    handleOpenExisting(proj, word.lineId);
                                  }
                                }}
                                className="bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/60 p-4 rounded-xl transition-all cursor-pointer flex flex-col justify-between"
                              >
                                <div className="flex justify-between items-start mb-2">
                                  <div>
                                    <h4 className="text-lg font-black text-white leading-tight">{word.text}</h4>
                                    {word.pfc && <p className="text-xs text-emerald-400 font-bold mt-0.5">{word.pfc}</p>}
                                  </div>
                                  
                                  {word.score !== undefined ? (
                                    <span className="text-[10px] font-black bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                                      {word.score}%
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-bold bg-neutral-950 text-neutral-500 px-1.5 py-0.5 rounded border border-neutral-800">
                                      Pendente
                                    </span>
                                  )}
                                </div>
                                
                                {word.hint && (
                                  <p className="text-[11px] text-neutral-400 line-clamp-2 mt-1 leading-snug mb-3">
                                    {word.hint}
                                  </p>
                                )}
                                
                                <div className="flex justify-between items-center text-[10px] text-neutral-500 mt-auto pt-2 border-t border-white/5 font-medium">
                                  <span>{word.attempts} {word.attempts === 1 ? 'tentativa' : 'tentativas'}</span>
                                  <span className="text-indigo-400 flex items-center gap-1">
                                    Estudar <ArrowRight className="w-3 h-3" />
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </section>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-200">
            {/* Play Queue Section */}
            {queue.length > 0 && (
              <div className="bg-neutral-900 border border-indigo-500/20 rounded-2xl p-4 md:p-6 shadow-lg shadow-indigo-500/5">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                    <ListMusic className="w-5 h-5 text-indigo-400" />
                    Fila de Reprodução ({queue.length} {queue.length === 1 ? 'música' : 'músicas'})
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onPlayQueue(0)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Tocar Fila
                    </button>
                    <button
                      onClick={onClearQueue}
                      className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      Limpar Fila
                    </button>
                  </div>
                </div>
                
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {queue.map((qProj, index) => (
                    <div 
                      key={`${qProj.id}_${index}`}
                      className="flex items-center justify-between bg-neutral-950 hover:bg-neutral-900/40 p-2.5 rounded-xl border border-neutral-800/80 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono text-neutral-500 w-4 text-center">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-neutral-200 truncate">{qProj.metadata.title}</p>
                          <p className="text-[11px] text-neutral-400 truncate">{qProj.metadata.artist}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onPlayQueue(index)}
                          className="text-neutral-400 hover:text-indigo-400 p-1.5 rounded-lg transition-colors"
                          title="Tocar a partir daqui"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onRemoveFromQueue(qProj.id, index)}
                          className="text-neutral-500 hover:text-red-400 p-1.5 rounded-lg transition-colors"
                          title="Remover da fila"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <h2 className="text-2xl font-bold">Biblioteca Local</h2>
                
                {/* Tabs for Filtering (All vs Favorites) */}
                <div className="flex gap-1.5 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
                  <button
                    onClick={() => setActiveTab("all")}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                      activeTab === "all"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/15"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    Todas as Músicas
                  </button>
                  <button
                    onClick={() => setActiveTab("favorites")}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center gap-1.5 ${
                      activeTab === "favorites"
                        ? "bg-amber-500 text-black shadow-md shadow-amber-500/15"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                    Favoritos ({projects.filter(p => p.favorite).length})
                  </button>
                </div>
              </div>

          {(() => {
            const now = new Date().toISOString();
            
            let displayedProjects = projects;
            if (activeTab === "favorites") {
              displayedProjects = projects.filter(p => p.favorite);
            }

            if (displayedProjects.length === 0) {
              return (
                <div className="text-center py-24 bg-neutral-900 border border-neutral-800 rounded-3xl">
                  {activeTab === "all" ? (
                    <>
                      <Search className="w-12 h-12 text-neutral-700 mx-auto mb-4" />
                      <p className="text-neutral-400 font-medium">Nenhum projeto salvo.</p>
                      <p className="text-neutral-500 text-sm mt-1">Importe arquivos acima para começar.</p>
                    </>
                  ) : activeTab === "favorites" ? (
                    <>
                      <Star className="w-12 h-12 text-neutral-700 mx-auto mb-4" />
                      <p className="text-neutral-400 font-medium">Nenhum projeto favoritado.</p>
                      <p className="text-neutral-500 text-sm mt-1">Clique na estrela (★) dos projetos para adicioná-los aos seus favoritos.</p>
                    </>
                  ) : (
                    <>
                      <Clock className="w-12 h-12 text-neutral-700 mx-auto mb-4" />
                      <p className="text-neutral-400 font-medium">Nada para revisar hoje.</p>
                      <p className="text-neutral-500 text-sm mt-1">Ótimo trabalho! Pratique mais músicas para acumular revisões.</p>
                    </>
                  )}
                </div>
              );
            }

            return (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedProjects.map(proj => {
                  const hasTokens = proj.lines.some(l => l.tokens && l.tokens.length > 0);
                  const hasSegments = !hasTokens && proj.lines.some(l => l.segments && l.segments.length > 0);
                  const hasStudy = proj.lines.some(l => !!l.study);
                  
                  const projItems = progress?.items.filter(i => i.projectId === proj.id && i.type === 'line') || [];
                  const dueToday = projItems.filter(i => i.dueAt <= now).length;
                  const totalPracticed = projItems.length;
                  const totalLines = proj.lines.length;
                  
                  let overallStatus = 'Novo';
                  if (dueToday > 0) overallStatus = 'Revisar hoje';
                  else if (totalPracticed > 0) overallStatus = 'Em estudo';
                  if (totalPracticed > 0 && projItems.every(i => i.status === 'mastered')) overallStatus = 'Dominada';
                  
                  return (
                    <div 
                      key={proj.id} 
                      className="group bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 transition-colors rounded-2xl overflow-hidden cursor-pointer flex flex-col"
                      onClick={() => handleOpenExisting(proj)}
                    >
                      <div className="relative aspect-video bg-neutral-950 shrink-0 w-full overflow-hidden">
                        {getSongCover(proj) ? (
                          <img 
                            src={getSongCover(proj)} 
                            alt="Thumbnail" 
                            className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="absolute inset-0 w-full h-full flex items-center justify-center">
                            <Music className="w-12 h-12 text-neutral-800" />
                          </div>
                        )}
                        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-neutral-200 bg-neutral-950/80 rounded border border-white/5 backdrop-blur-sm z-10 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-neutral-400" />
                          <span>{getSongDuration(proj)}</span>
                        </div>
                        {(() => {
                          const highScore = getProjectHighScore(proj);
                          if (highScore === null) return null;
                          return (
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-amber-950 bg-amber-400 border border-amber-300 rounded shadow-md shadow-amber-500/20 z-10 flex items-center gap-1 font-semibold">
                              <Trophy className="w-3 h-3 text-amber-900 fill-amber-900" />
                              <span>Score: {highScore}%</span>
                            </div>
                          );
                        })()}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="bg-indigo-600 text-white rounded-full p-3 transform scale-90 group-hover:scale-100 transition-transform">
                            <Play className="w-6 h-6 ml-1" />
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 flex flex-col flex-1">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <h3 className="font-bold text-lg leading-tight line-clamp-1 flex-1 min-w-0" title={proj.metadata.title}>{proj.metadata.title}</h3>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Toggle Favorite */}
                            <button
                              onClick={(e) => handleToggleFavorite(e, proj)}
                              className={`p-1 rounded-lg transition-colors ${
                                proj.favorite 
                                  ? 'text-amber-400 hover:text-amber-300' 
                                  : 'text-neutral-500 hover:text-neutral-300'
                              }`}
                              title={proj.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                            >
                              <Star className={`w-4 h-4 ${proj.favorite ? 'fill-current' : ''}`} />
                            </button>
                            
                            {/* Add to Play Queue */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddToQueue(proj);
                              }}
                              className="text-neutral-500 hover:text-indigo-400 p-1 rounded-lg transition-colors"
                              title="Adicionar à fila"
                            >
                              <Plus className="w-4 h-4" />
                            </button>

                            {/* Delete Project */}
                            <button 
                              onClick={(e) => handleDelete(e, proj.id)}
                              className="text-neutral-600 hover:text-red-400 p-1 rounded-lg transition-colors"
                              title="Remover"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-neutral-400 text-sm mb-4 line-clamp-1">{proj.metadata.artist}</p>
                        
                        <div className="mt-auto flex flex-wrap gap-2 mb-3">
                          {hasSegments && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-blue-500/10 text-blue-400">
                              Segmentos
                            </span>
                          )}
                          {proj.difficulty?.pronunciation?.level && (
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded border ${
                              proj.difficulty.pronunciation.level === "easy" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                              proj.difficulty.pronunciation.level === "medium" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                              "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            }`}>
                              {proj.difficulty.pronunciation.level === "easy" && "Pronúncia Fácil"}
                              {proj.difficulty.pronunciation.level === "medium" && "Pronúncia Média"}
                              {proj.difficulty.pronunciation.level === "hard" && "Pronúncia Difícil"}
                            </span>
                          )}
                          {proj.difficulty?.rhythm?.level && (
                            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded border ${
                              proj.difficulty.rhythm.level === "easy" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                              proj.difficulty.rhythm.level === "medium" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                              "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            }`}>
                              {proj.difficulty.rhythm.level === "easy" && "Ritmo Fácil"}
                              {proj.difficulty.rhythm.level === "medium" && "Ritmo Médio"}
                              {proj.difficulty.rhythm.level === "hard" && "Ritmo Difícil"}
                            </span>
                          )}
                        </div>

                        {/* User Progress Stats */}
                        {(totalPracticed > 0 || dueToday > 0) && (
                          <div className="pt-3 border-t border-white/10 flex flex-wrap gap-x-4 gap-y-2 mt-auto">
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Status</span>
                              <span className={`text-xs font-semibold ${
                                overallStatus === 'Revisar hoje' ? 'text-indigo-400' :
                                overallStatus === 'Dominada' ? 'text-emerald-400' :
                                'text-sky-400'
                              }`}>{overallStatus}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Revisões</span>
                              <span className="text-xs font-semibold text-neutral-300">{dueToday} hoje</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Progresso</span>
                              <span className="text-xs font-semibold text-neutral-300">{totalPracticed}/{totalLines} linhas</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      </div>
    )}
      </div>
    </div>
  );
}
