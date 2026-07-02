import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, ArrowDown, BookOpen, ChevronLeft, Download, ListChecks, Mic, Music2, Pause, Play, RefreshCw, Settings2, Target, Volume2, VolumeX, X, Maximize, SkipBack, SkipForward } from "lucide-react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { KaraokeToken, PlayerMode, SongProject, SongLine, LayerKey } from "../types";
import clsx from "clsx";
import { dbService } from "../lib/db";
import { projectStorage } from "../services/projectStorage";
import { exportService, hasStudyData } from "../services/exportService";
import { PracticeModal } from "./PracticeModal";
import { Waveform } from "./player/Waveform";

const formatClock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
};

const NEXT_LINE_PREP_SECONDS = 2.5;

interface PlayerScreenProps {
  project: SongProject;
  audioBlob?: Blob; // Used when passed directly
  onBack: () => void;
  onUpdateProject?: (project: SongProject) => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  onNext?: () => void;
  onPrevious?: () => void;
  queueInfo?: string;
  shouldAutoplay?: boolean;
}

interface StudyTokenSelection {
  line: SongLine;
  token: KaraokeToken;
}

interface StudyLoopRange {
  type: "line" | "segment";
  lineId: string;
  label: string;
  start: number;
  end: number;
}

const LAYER_LABELS: Record<LayerKey, string> = {
  original: "Letra Original",
  ipa: "IPA (Fonética)",
  translationPt: "Tradução (PT-BR)",
  pfc: "PFC (Karaokê BR)",
  tip: "Dicas de Canto"
};

const LAYER_COLORS: Record<LayerKey, string> = {
  original: "text-neutral-100",
  ipa: "text-fuchsia-300",
  translationPt: "text-blue-300",
  pfc: "text-emerald-400",
  tip: "text-amber-300 italic"
};

function getLinePlaybackEnd(line: SongLine, index: number, lines: SongLine[]) {
  const start = line.start || 0;
  const nextStart = index < lines.length - 1 ? (lines[index + 1].start || 0) : start + 5;
  const end = (line.end && line.end > start) ? line.end : nextStart;
  return Math.max(start + 0.4, end);
}

function getActiveSegment(line: SongLine, currentTime: number) {
  const segments = Array.isArray(line.segments) ? line.segments : [];
  const timedSegments = segments.filter(segment =>
    Number.isFinite(segment.start)
    && Number.isFinite(segment.end)
    && segment.end > segment.start
  );
  if (!timedSegments.length) return null;

  return timedSegments.find(segment => currentTime >= segment.start && currentTime < segment.end)
    || timedSegments.find(segment => segment.start > currentTime)
    || timedSegments[0];
}

function isSameLoopRange(a: StudyLoopRange | null, b: StudyLoopRange) {
  return Boolean(a
    && a.type === b.type
    && a.lineId === b.lineId
    && Math.abs(a.start - b.start) < 0.01
    && Math.abs(a.end - b.end) < 0.01
  );
}

const HIGH_IMPACT_FOCUS_SOUNDS = new Set([
  "final seco",
  "epêntese",
  "H aspirado",
  "TH surdo",
  "TH sonoro",
  "L escuro",
  "V sonoro",
  "Z sonoro",
  "vogal tensa",
  "vogal curta",
  "/æ/ aberto",
  "/æ/ vs /ɛ/",
  "schwa",
  "linking",
  "assimilação T+Y",
  "assimilação D+Y",
  "flap T/D",
  "cluster consonantal",
]);

function getStudyTokenTone(token: KaraokeToken) {
  const study = token.study;
  if (!study) return null;
  if (study.difficulty === "hard") return "hard";
  if (study.focusSounds.some(sound => HIGH_IMPACT_FOCUS_SOUNDS.has(sound))) return "marked";
  return "soft";
}

function getStudyDrillItems(drill?: NonNullable<SongLine["study"]>["drill"]) {
  if (!drill) return [];
  return [
    { key: "slow", label: "Devagar", value: drill.slow?.trim() || "" },
    { key: "connected", label: "Conectado", value: drill.connected?.trim() || "" },
    { key: "rhythm", label: "Ritmo", value: drill.rhythm?.trim() || "" },
  ].filter(item => Boolean(item.value));
}

export const PlayerScreen: React.FC<PlayerScreenProps> = ({ 
  project, 
  audioBlob, 
  onBack, 
  onUpdateProject,
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
  queueInfo,
  shouldAutoplay
}) => {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bgColor, setBgColor] = useState("rgba(15, 10, 30, 1)");
  const [showSettings, setShowSettings] = useState(false);
  const [playerMode, setPlayerMode] = useState<PlayerMode>(project.playerMode || "karaoke");
  const [visibleLayers, setVisibleLayers] = useState<LayerKey[]>(project.visibleLayers || ["pfc", "original", "translationPt"]);
  const [syncOffset, setSyncOffset] = useState(project.syncOffset || 0);
  const [duration, setDuration] = useState(project.metadata?.duration || 0);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoadState, setAudioLoadState] = useState<"idle" | "loading" | "ready" | "missing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const projectRef = useRef(project);
  const currentTimeRef = useRef(0);
  const studyLoopRef = useRef<StudyLoopRange | null>(null);
  const onUpdateProjectRef = useRef(onUpdateProject);

  const [selectedStudyToken, setSelectedStudyToken] = useState<StudyTokenSelection | null>(null);
  const [practiceLineIndex, setPracticeLineIndex] = useState<number | null>(null);
  const [studyLoop, setStudyLoop] = useState<StudyLoopRange | null>(null);
  const [expandedDrillLineId, setExpandedDrillLineId] = useState<string | null>(null);
  const [expandedCuesLineId, setExpandedCuesLineId] = useState<string | null>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  // Reset state when project changes
  useEffect(() => {
    projectRef.current = project;
    setPlayerMode(project.playerMode || "karaoke");
    setVisibleLayers(project.visibleLayers || ["pfc", "original", "translationPt"]);
    setSyncOffset(project.syncOffset || 0);
    setDuration(project.metadata?.duration || 0);
    setSelectedStudyToken(null);
    setPracticeLineIndex(null);
    setStudyLoop(null);
    setExpandedDrillLineId(null);
    setExpandedCuesLineId(null);
    setIsAutoScroll(true);
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setPlaying(false);
    
    if (audioRef.current) {
      if (project.progress?.lastTimestamp && project.progress.lastTimestamp > 0) {
        audioRef.current.currentTime = project.progress.lastTimestamp;
        setCurrentTime(project.progress.lastTimestamp);
        currentTimeRef.current = project.progress.lastTimestamp;
      } else {
        audioRef.current.currentTime = 0;
      }
    } else if (project.progress?.lastTimestamp) {
      setCurrentTime(project.progress.lastTimestamp);
      currentTimeRef.current = project.progress.lastTimestamp;
    }
  }, [project.id]);

  // Equalizer Frequencies (Gains in dB, -12 to 12)
  const [bassGain, setBassGain] = useState<number>(0);
  const [midGain, setMidGain] = useState<number>(0);
  const [trebleGain, setTrebleGain] = useState<number>(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const midFilterRef = useRef<BiquadFilterNode | null>(null);
  const trebleFilterRef = useRef<BiquadFilterNode | null>(null);

  // Load equalizer settings from IndexedDB on mount
  useEffect(() => {
    const loadEQSettings = async () => {
      try {
        const saved = await dbService.getSetting<{ bass: number; mid: number; treble: number }>("eqSettings");
        if (saved) {
          const b = typeof saved.bass === "number" ? saved.bass : 0;
          const m = typeof saved.mid === "number" ? saved.mid : 0;
          const t = typeof saved.treble === "number" ? saved.treble : 0;
          setBassGain(b);
          setMidGain(m);
          setTrebleGain(t);
          if (bassFilterRef.current) bassFilterRef.current.gain.value = b;
          if (midFilterRef.current) midFilterRef.current.gain.value = m;
          if (trebleFilterRef.current) trebleFilterRef.current.gain.value = t;
        }
      } catch (err) {
        console.error("Erro ao carregar configurações do equalizador do banco:", err);
      }
    };
    loadEQSettings();
  }, []);

  // Set up the Web Audio API nodes and chain
  useEffect(() => {
    if (!audioRef.current || !audioUrl) return;

    let ctx = audioCtxRef.current;
    if (!ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AudioContextClass();
      audioCtxRef.current = ctx;
    }

    if (!bassFilterRef.current) {
      const bass = ctx.createBiquadFilter();
      bass.type = "lowshelf";
      bass.frequency.value = 150;
      bass.gain.value = bassGain;
      bassFilterRef.current = bass;
    }

    if (!midFilterRef.current) {
      const mid = ctx.createBiquadFilter();
      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 1;
      mid.gain.value = midGain;
      midFilterRef.current = mid;
    }

    if (!trebleFilterRef.current) {
      const treble = ctx.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = 6000;
      treble.gain.value = trebleGain;
      trebleFilterRef.current = treble;
    }

    if (!sourceNodeRef.current) {
      try {
        const source = ctx.createMediaElementSource(audioRef.current);
        sourceNodeRef.current = source;
        // Chain: source -> bass -> mid -> treble -> destination
        source.connect(bassFilterRef.current);
        bassFilterRef.current.connect(midFilterRef.current);
        midFilterRef.current.connect(trebleFilterRef.current);
        trebleFilterRef.current.connect(ctx.destination);
      } catch (err) {
        console.warn("Elemento de áudio já conectado ou Web Audio não suportado:", err);
      }
    }

    if (ctx.state === "suspended") {
      const resume = () => {
        ctx?.resume();
        window.removeEventListener("click", resume);
        window.removeEventListener("keydown", resume);
      };
      window.addEventListener("click", resume);
      window.addEventListener("keydown", resume);
      return () => {
        window.removeEventListener("click", resume);
        window.removeEventListener("keydown", resume);
      };
    }
  }, [audioUrl, audioRef.current]);

  const handleBassChange = useCallback((val: number) => {
    setBassGain(val);
    if (bassFilterRef.current) {
      bassFilterRef.current.gain.value = val;
    }
    setMidGain(currentMid => {
      setTrebleGain(currentTreble => {
        dbService.saveSetting("eqSettings", { bass: val, mid: currentMid, treble: currentTreble }).catch(console.error);
        return currentTreble;
      });
      return currentMid;
    });
  }, []);

  const handleMidChange = useCallback((val: number) => {
    setMidGain(val);
    if (midFilterRef.current) {
      midFilterRef.current.gain.value = val;
    }
    setBassGain(currentBass => {
      setTrebleGain(currentTreble => {
        dbService.saveSetting("eqSettings", { bass: currentBass, mid: val, treble: currentTreble }).catch(console.error);
        return currentTreble;
      });
      return currentBass;
    });
  }, []);

  const handleTrebleChange = useCallback((val: number) => {
    setTrebleGain(val);
    if (trebleFilterRef.current) {
      trebleFilterRef.current.gain.value = val;
    }
    setBassGain(currentBass => {
      setMidGain(currentMid => {
        dbService.saveSetting("eqSettings", { bass: currentBass, mid: currentMid, treble: val }).catch(console.error);
        return currentMid;
      });
      return currentBass;
    });
  }, []);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    setPlayerMode(project.playerMode || "karaoke");
    setSelectedStudyToken(null);
    setStudyLoop(null);
    setExpandedDrillLineId(null);
    setExpandedCuesLineId(null);
  }, [project.id, project.playerMode]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    studyLoopRef.current = studyLoop;
  }, [studyLoop]);

  useEffect(() => {
    onUpdateProjectRef.current = onUpdateProject;
  }, [onUpdateProject]);

  const persistProjectUpdate = useCallback((patch: Partial<SongProject>) => {
    const updatedProject = {
      ...projectRef.current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    projectRef.current = updatedProject;
    projectStorage.saveProject(updatedProject).catch(console.error);
    onUpdateProjectRef.current?.(updatedProject);
  }, []);

  const togglePlayback = useCallback(() => {
    if (!audioRef.current) return;

    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(console.error);
    }

    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().then(() => {
        setPlaying(true);
        setIsAutoScroll(true);
      }).catch(console.error);
    }
  }, [playing]);

  const handleModeChange = useCallback((mode: PlayerMode) => {
    setPlayerMode(mode);
    persistProjectUpdate({ playerMode: mode });
    if (mode === "karaoke") {
      setSelectedStudyToken(null);
      setStudyLoop(null);
    }
  }, [persistProjectUpdate]);

  const seekToPlaybackTime = useCallback((time: number, shouldPlay = true) => {
    if (!audioRef.current) return;
    const seekTime = Math.max(0, time - syncOffset);
    audioRef.current.currentTime = seekTime;
    setCurrentTime(seekTime + syncOffset);
    setIsAutoScroll(true);
    if (shouldPlay) {
      audioRef.current.play()
        .then(() => setPlaying(true))
        .catch(console.error);
    }
  }, [syncOffset]);

  const toggleStudyLoop = useCallback((range: StudyLoopRange) => {
    setStudyLoop(prev => {
      if (isSameLoopRange(prev, range)) return null;
      seekToPlaybackTime(range.start, true);
      return range;
    });
  }, [seekToPlaybackTime]);

  const handleManualScroll = useCallback(() => {
    setIsAutoScroll(false);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsAutoScroll(true);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    // Determine background color deterministically from title+artist
    const id = (project.metadata?.title || "Unknown") + (project.metadata?.artist || "Unknown");
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const r = Math.abs((hash & 0xFF0000) >> 16) % 60 + 10;
    const g = Math.abs((hash & 0x00FF00) >> 8) % 60 + 10;
    const b = Math.abs(hash & 0x0000FF) % 60 + 30;
    setBgColor(`rgba(${r}, ${g}, ${b}, 1)`);

    // Load audio
    let currentUrl: string | null = null;
    let isCancelled = false;
    setAudioUrl(null);

    const loadAudioBlob = async () => {
      setAudioLoadState("loading");
      
      let blob = audioBlob;
      if (!blob && project.audioBlobId) {
         try {
            blob = await projectStorage.getAudioBlob(project.audioBlobId);
         } catch (e) {
            console.error("Failed to load project audio", e);
            if (!isCancelled) setAudioLoadState("error");
            return;
         }
      }

      if (isCancelled) return;

      if (blob) {
        currentUrl = URL.createObjectURL(blob);
        setAudioUrl(currentUrl);
        setAudioLoadState("ready");
        if (shouldAutoplay) {
          // Attempt to play on load if requested
          setTimeout(() => {
             if (audioRef.current) {
                audioRef.current.play().then(() => {
                  setPlaying(true);
                  setIsAutoScroll(true);
                }).catch(console.error);
             }
          }, 100);
        }
      } else {
        setAudioLoadState("missing");
      }
    };

    loadAudioBlob();

    return () => {
      isCancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [project.id, project.audioBlobId, audioBlob, shouldAutoplay]);

  useEffect(() => {
    let animationFrame: number;
    let lastUpdateTime = 0;
    const FPS = 15; // Limit re-renders to 15fps (approx ~66ms)
    const frameInterval = 1000 / FPS;

    const updateTime = (now: number) => {
      if (audioRef.current && playing) {
        const audioTime = audioRef.current.currentTime;
        const displayTime = audioTime + syncOffset;
        
        // Update ref immediately for high-precision things like loop bounds
        currentTimeRef.current = displayTime;

        const loop = studyLoopRef.current;
        if (loop && displayTime >= loop.end) {
          const seekTime = Math.max(0, loop.start - syncOffset);
          audioRef.current.currentTime = seekTime;
          setCurrentTime(seekTime + syncOffset);
          lastUpdateTime = now; // reset throttle
        } else {
          if (now - lastUpdateTime >= frameInterval) {
            setCurrentTime(displayTime);
            lastUpdateTime = now;
          }
        }
        animationFrame = requestAnimationFrame(updateTime);
      }
    };
    if (playing) {
      animationFrame = requestAnimationFrame(updateTime);
    }
    return () => cancelAnimationFrame(animationFrame);
  }, [playing, syncOffset]);

  const handleAudioEnded = useCallback(() => {
    setPlaying(false);
    setStudyLoop(null);
    if (onNext) {
      onNext();
    }
  }, [onNext]);

  const handleAudioError = useCallback((e: any) => {
    console.error("Audio error:", e);
    setAudioLoadState("error");
    setPlaying(false);
  }, []);

  const activeLineIndex = useMemo(() => {
    const idx = project.lines.findIndex((line, i) => {
      const start = line.start || 0;
      const nextStart = i < project.lines.length - 1 ? (project.lines[i + 1].start || 0) : start + 5;
      const end = (line.end && line.end > start) ? line.end : nextStart;
      return currentTime >= start && currentTime < end;
    });
    if (idx !== -1) return idx;
    
    // Find closest future line if not actively in one
    const nextIdx = project.lines.findIndex(line => (line.start || 0) > currentTime);
    if (nextIdx > 0) return nextIdx - 1;
    if (nextIdx === -1 && project.lines.length > 0) {
      // If we are past the last line's start time, keep the last line active
      const lastLine = project.lines[project.lines.length - 1];
      if (currentTime >= (lastLine.start || 0)) {
        return project.lines.length - 1;
      }
    }
    return -1;
  }, [currentTime, project.lines]);

  const hasStudyLayer = useMemo(() => hasStudyData(project.lines), [project.lines]);
  const practiceScores = useMemo<Record<string, number[]>>(() => (
    project.progress?.practiceScores || {}
  ), [project.progress?.practiceScores]);
  const practiceScoreEntries = useMemo<Array<[string, number[]]>>(() => (
    Object.entries(practiceScores) as Array<[string, number[]]>
  ), [practiceScores]);

  useEffect(() => {
    if (isAutoScroll && activeLineIndex !== -1 && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: activeLineIndex, align: "center", behavior: "smooth" });
      const frame = requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: activeLineIndex, align: "center", behavior: "auto" });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [activeLineIndex, isAutoScroll]);

  // Load last timestamp on mount
  useEffect(() => {
    if (project.progress?.lastTimestamp && currentTime === 0) {
      if (audioRef.current) {
        audioRef.current.currentTime = project.progress.lastTimestamp;
      }
      setCurrentTime(project.progress.lastTimestamp);
    }
  }, [project.progress?.lastTimestamp]);

  // Save progress periodically
  useEffect(() => {
    if (!playing) return;

    const interval = setInterval(() => {
      const timestamp = currentTimeRef.current;
      if (timestamp <= 0) return;

      const baseProject = projectRef.current;
      const updatedProject = {
        ...baseProject,
        updatedAt: new Date().toISOString(),
        progress: {
          ...baseProject.progress,
          lastTimestamp: timestamp
        }
      };
      projectRef.current = updatedProject;
      projectStorage.saveProject(updatedProject).catch(console.error);
      onUpdateProjectRef.current?.(updatedProject);
    }, 5000);

    return () => clearInterval(interval);
  }, [playing]);

  const toggleLayer = (layer: LayerKey) => {
    setVisibleLayers(prev => {
      if (prev.includes(layer)) {
        return prev.filter(l => l !== layer);
      } else {
        if (prev.length >= 3) {
          // Replace the last one if we have 3
          return [...prev.slice(0, 2), layer];
        }
        return [...prev, layer];
      }
    });
  };

  useEffect(() => {
    // Save layer preferences when they change
    persistProjectUpdate({ visibleLayers });
  }, [visibleLayers, persistProjectUpdate]);

  const renderLine = useCallback((line: SongLine | undefined, isActive: boolean, index: number) => {
    if (!line) return <div className="h-24" />;

    const secondsUntilLine = (line.start || 0) - currentTime;
    const isPreparingNext = !isActive
      && index === activeLineIndex + 1
      && secondsUntilLine > 0
      && secondsUntilLine <= NEXT_LINE_PREP_SECONDS;
    const prepProgress = isPreparingNext
      ? Math.max(0, Math.min(100, ((NEXT_LINE_PREP_SECONDS - secondsUntilLine) / NEXT_LINE_PREP_SECONDS) * 100))
      : 0;
    const lineStart = line.start || 0;
    const lineEnd = getLinePlaybackEnd(line, index, project.lines);
    const activeSegment = getActiveSegment(line, currentTime);
    const lineLoopRange: StudyLoopRange = {
      type: "line",
      lineId: line.id,
      label: "Linha",
      start: lineStart,
      end: lineEnd,
    };
    const drillItems = getStudyDrillItems(line.study?.drill);
    const isDrillOpen = drillItems.length > 0 && expandedDrillLineId === line.id;

    // Karaoke fill progress logic
    let progress = 0;
    if (currentTime >= lineStart) {
      const actualDuration = Math.max(0.1, lineEnd - lineStart);
      const estimatedDuration = Math.min(
        actualDuration, 
        Math.max(1.0, (line.original || "").length * 0.08)
      );
      
      const timeInLine = currentTime - lineStart;
      
      if (timeInLine >= estimatedDuration) {
        progress = 100;
      } else {
        progress = Math.max(0, Math.min(100, (timeInLine / estimatedDuration) * 100));
      }
    }

    return (
        <div
          key={line.id || index}
          style={{
            opacity: isActive ? 1 : (isPreparingNext ? 0.7 : 0.25),
            transform: isActive ? "scale(1.02)" : (isPreparingNext ? "translateY(-4px)" : "none"),
          }}
          className={clsx(
            "w-full text-center transition-all duration-300 group relative flex items-center justify-center select-none",
            isActive 
              ? "min-h-[5.5rem] py-2.5 md:min-h-[7.5rem] md:py-4 lg:min-h-[10rem] lg:py-6" 
              : isPreparingNext
                ? "min-h-[3.8rem] py-2 md:min-h-[4.8rem] md:py-3 lg:min-h-[6.2rem] lg:py-4"
                : "min-h-[2.8rem] py-1 md:min-h-[3.8rem] md:py-1.5 lg:min-h-[5rem] lg:py-2.5",
            isActive ? "" : "cursor-pointer hover:opacity-80"
          )}
          onClick={() => {
            if (!isActive) {
              seekToPlaybackTime(lineStart, !playing);
            }
          }}
        >
        {isActive && (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setPlaying(false);
              if (audioRef.current) audioRef.current.pause();
              setPracticeLineIndex(index);
            }}
            className="absolute top-1 right-1 xs:top-1.5 xs:right-1.5 sm:top-2 sm:right-2 md:top-3 md:right-3 lg:top-5 lg:right-8 opacity-35 hover:opacity-100 transition-all duration-300 bg-neutral-800/60 hover:bg-indigo-600 hover:scale-105 text-white p-1 xs:p-1.5 md:p-2 lg:p-2.5 rounded-full shadow z-10 backdrop-blur-sm"
            title="Praticar Pronúncia"
          >
            <Mic className="w-3 h-3 xs:w-3.5 xs:h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6" />
          </button>
        )}
        <div className={clsx(
          "flex flex-col items-center justify-center w-full transition-all duration-300", 
          isActive 
            ? "gap-1 px-4 xs:px-5 sm:px-8 md:gap-2 md:px-14 md:pr-16 lg:gap-3 lg:px-20 lg:pr-24" 
            : isPreparingNext
              ? "gap-2.5 px-4 md:gap-3.5 md:px-12 lg:gap-4.5 lg:px-16"
              : "gap-0.5 px-4 md:gap-1 md:px-12 lg:gap-1.5 lg:px-16"
        )}>
          {isPreparingNext && (
            <div className="w-24 h-1 rounded-full bg-white/10 overflow-hidden mb-2 sm:mb-2.5 md:mb-3.5 lg:mb-4.5 shrink-0">
              <div
                className="h-full rounded-full bg-emerald-400"
                style={{ width: `${prepProgress}%` }}
              />
            </div>
          )}
          {(() => {
            const displayLayers = playerMode === "study"
              ? (["original", "pfc", "translationPt"] as LayerKey[])
              : [...visibleLayers];
            if (playerMode === "karaoke" && displayLayers.length === 3) {
              const temp = displayLayers[0];
              displayLayers[0] = displayLayers[1];
              displayLayers[1] = temp;
            }
            return displayLayers.map((layer) => {
              const layerIndex = visibleLayers.indexOf(layer);
              const text = line[layer];
              if (!text) return null;
              const isFocused = playerMode === "study" ? layer === "pfc" : layerIndex === 0;
              
              // Only apply active filling to the currently playing line
              const currentProgress = isActive ? progress : 0;
              
              const renderText = () => {
                const tokens = Array.isArray(line.tokens) ? line.tokens : (Array.isArray(line.words) ? line.words : []);
                const parts = tokens.length > 0 ? tokens : (Array.isArray(line.segments) && line.segments.length > 0 ? line.segments : null);
                
                if (parts && (layer === "original" || layer === "pfc")) {
                  return (
                    <div className="flex flex-wrap items-center justify-center gap-x-[0.2em] gap-y-[0.05em] md:gap-x-[0.25em] md:gap-y-[0.1em] lg:gap-x-[0.3em] lg:gap-y-[0.15em]">
                      {parts.map((p: any, i: number) => {
                        let wordProgress = 0;
                        const wStart = p.start || 0;
                        const wNextStart = i < parts.length - 1 ? (parts[i+1].start || 0) : wStart + 1;
                        const wEnd = (p.end && p.end > wStart) ? p.end : wNextStart;
                        const isCurrentWord = isActive && currentTime >= wStart && currentTime < wEnd;
                        
                        if (currentTime >= wEnd) {
                          wordProgress = 100;
                        } else if (currentTime >= wStart) {
                          const wordDuration = Math.max(0.01, wEnd - wStart);
                          wordProgress = Math.max(0, Math.min(100, ((currentTime - wStart) / wordDuration) * 100));
                        }
                        
                        // For inactive lines, we can still use the line-level currentProgress or just 0/100
                        const actualWordProgress = isActive ? wordProgress : 0;
                        const tokenText = p.text || p.original || p.word;
                        const wordText = layer === "original" ? tokenText : (p.pfc || tokenText);
                        const canOpenStudy = playerMode === "study" && layer === "pfc" && Boolean(p.study);
                        const tokenTone = canOpenStudy ? getStudyTokenTone(p as KaraokeToken) : null;
                        const studyFocusTitle = canOpenStudy && Array.isArray(p.study?.focusSounds) && p.study.focusSounds.length
                          ? `Abrir dica: ${p.study.focusSounds.join(", ")}`
                          : "Abrir dica da palavra";
                        
                        if (!wordText) return null;
                         
                        return (
                          <span
                            key={p.id || i}
                            className={clsx(
                              "inline-block rounded-md px-0.5 transition-[filter,opacity,text-shadow,background-color,box-shadow] duration-150",
                              isCurrentWord ? "opacity-100" : "opacity-90",
                              canOpenStudy && "hover:brightness-125",
                              tokenTone === "hard" && "bg-rose-300/10 ring-1 ring-rose-300/30",
                              tokenTone === "marked" && "bg-amber-300/10 ring-1 ring-amber-300/25",
                              tokenTone === "soft" && "bg-sky-300/5 ring-1 ring-sky-300/15"
                            )}
                            role={canOpenStudy ? "button" : undefined}
                            tabIndex={canOpenStudy ? 0 : undefined}
                            title={canOpenStudy ? studyFocusTitle : undefined}
                            onClick={(e) => {
                              if (!canOpenStudy) return;
                              e.stopPropagation();
                              setSelectedStudyToken({ line, token: p as KaraokeToken });
                            }}
                            onKeyDown={(e) => {
                              if (!canOpenStudy || (e.key !== "Enter" && e.key !== " ")) return;
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedStudyToken({ line, token: p as KaraokeToken });
                            }}
                            style={{
                              backgroundImage: `linear-gradient(to right, currentColor ${actualWordProgress}%, rgba(255, 255, 255, 0.3) ${actualWordProgress}%)`,
                              WebkitBackgroundClip: "text",
                              WebkitTextFillColor: "transparent",
                              backgroundClip: "text",
                              filter: isCurrentWord ? "brightness(1.15)" : "none",
                              textShadow: isCurrentWord ? "0 1px 0 rgba(255, 255, 255, 0.18)" : "none",
                              textDecorationLine: isCurrentWord ? "underline" : "none",
                              textDecorationColor: "rgba(52, 211, 153, 0.75)",
                              textDecorationThickness: "0.08em",
                              textUnderlineOffset: "0.16em",
                              cursor: canOpenStudy ? "pointer" : "inherit",
                            }}
                          >
                            {wordText}
                          </span>
                        );
                      })}
                    </div>
                  );
                }

                if (layer === "translationPt" || layer === "ipa") {
                  return <span>{text}</span>;
                }

                return (
                  <span
                    style={{
                      backgroundImage: `linear-gradient(to right, currentColor ${currentProgress}%, rgba(255, 255, 255, 0.3) ${currentProgress}%)`,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text"
                    }}
                  >
                    {text}
                  </span>
                );
              };

              return (
                <div 
                  key={layer}
                  className={clsx(
                    LAYER_COLORS[layer],
                    isActive 
                      ? (isFocused 
                          ? "text-[1.25rem] xs:text-[1.35rem] leading-[1.15] font-bold text-emerald-300 drop-shadow-[0_2px_6px_rgba(16,185,129,0.15)] md:text-[1.85rem] md:leading-[1.2] lg:text-[2.25rem] xl:text-[2.75rem] lg:leading-[1.25]" 
                          : layer === "translationPt"
                            ? "text-[0.75rem] font-normal opacity-70 leading-normal md:text-[0.95rem] lg:text-[1.1rem] xl:text-lg"
                            : layer === "original"
                              ? "text-[0.7rem] xs:text-[0.75rem] font-medium opacity-45 leading-normal md:text-[0.9rem] md:opacity-60 lg:text-[1.05rem] xl:text-lg"
                              : "text-[0.85rem] font-semibold opacity-90 leading-normal md:text-[1.1rem] lg:text-[1.3rem] xl:text-xl"
                        ) 
                      : (isFocused 
                          ? "text-[0.85rem] font-medium opacity-35 md:text-[1.1rem] md:font-semibold md:opacity-40 lg:text-[1.35rem] lg:font-bold lg:opacity-45" 
                          : "text-[10px] opacity-20 font-normal md:text-sm md:opacity-25 lg:text-base lg:opacity-30"
                        ),
                    "drop-shadow-lg tracking-tight w-full max-w-[80vw] xs:max-w-[82vw] sm:max-w-[75vw] md:max-w-xl lg:max-w-2xl xl:max-w-3xl text-center inline-block whitespace-normal break-words text-balance"
                  )}
                  style={{
                    fontFamily: layer === "ipa" ? "monospace" : "inherit",
                    wordBreak: "break-word",
                    textWrap: "balance"
                  }}
                >
                  {renderText()}
                </div>
              );
            });
          })()}
          {playerMode === "study" && isActive && line.study && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="study-mode-container mt-2.5 w-[94vw] max-w-[calc(100vw-16px)] xs:max-w-[25.5rem] sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl flex flex-col items-center gap-2 md:gap-3 lg:gap-4 rounded-lg md:rounded-xl lg:rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3.5 sm:p-5 md:p-6 text-center shadow-lg shadow-black/40 overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-center gap-1 md:gap-1.5 lg:gap-2">
                {line.study.focusSounds.slice(0, 4).map(sound => (
                  <span key={sound} className="rounded-full border border-amber-300/20 bg-amber-300/10 px-1.5 py-0.5 md:px-2.5 md:py-0.5 lg:px-3.5 lg:py-1 text-[9px] md:text-[11px] lg:text-sm font-semibold text-amber-200">
                    {sound}
                  </span>
                ))}
              </div>
              {line.study.practiceHintPt && (
                <p className="text-[11px] md:text-[13px] lg:text-sm xl:text-base font-medium leading-relaxed text-amber-100/90 max-w-full px-1 break-words text-balance">
                  {line.study.practiceHintPt}
                </p>
              )}
              <div className="flex w-full flex-wrap items-center justify-center gap-1 xs:gap-1.5 md:gap-2.5 lg:gap-3 mt-1.5 md:mt-2 lg:mt-2.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStudyLoop(lineLoopRange);
                  }}
                  className={clsx(
                    "inline-flex flex-1 min-w-0 justify-center items-center gap-0.5 xs:gap-1 rounded-full border px-1 py-1 xs:px-2 xs:py-1.5 text-[9px] xs:text-[10px] md:text-xs font-semibold transition-all duration-200",
                    isSameLoopRange(studyLoop, lineLoopRange)
                      ? "border-emerald-300/60 bg-emerald-300 text-black"
                      : "border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10"
                  )}
                  title="Repetir linha ativa"
                >
                  <RefreshCw className="h-2.5 w-2.5 xs:h-3 xs:w-3 shrink-0" />
                  <span className="truncate">Linha</span>
                </button>
                {drillItems.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDrillLineId(current => current === line.id ? null : line.id);
                    }}
                    className={clsx(
                      "inline-flex flex-1 min-w-0 justify-center items-center gap-0.5 xs:gap-1 rounded-full border px-1 py-1 xs:px-2 xs:py-1.5 text-[9px] xs:text-[10px] md:text-xs font-semibold transition-all duration-200",
                      isDrillOpen
                        ? "border-amber-300/60 bg-amber-300 text-black"
                        : "border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10"
                    )}
                    aria-expanded={isDrillOpen}
                    title="Praticar pronúncia detalhada"
                  >
                    <ListChecks className="h-2.5 w-2.5 xs:h-3 xs:w-3 shrink-0" />
                    <span className="truncate">Pronúncia</span>
                  </button>
                )}
                {(line.study.cues?.listeningGoalPt || line.study.cues?.mouthCuePt || line.study.cues?.preEntryCuePt) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedCuesLineId(current => current === line.id ? null : line.id);
                    }}
                    className={clsx(
                      "inline-flex flex-1 min-w-0 justify-center items-center gap-0.5 xs:gap-1 rounded-full border px-1 py-1 xs:px-2 xs:py-1.5 text-[9px] xs:text-[10px] md:text-xs font-semibold transition-all duration-200",
                      expandedCuesLineId === line.id
                        ? "border-sky-300/60 bg-sky-300 text-black"
                        : "border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10"
                    )}
                    title="Mostrar dicas de canto"
                  >
                    <Mic className="h-2.5 w-2.5 xs:h-3 xs:w-3 shrink-0" />
                    <span className="truncate">Canto</span>
                  </button>
                )}
              </div>
              <AnimatePresence initial={false}>
                {isDrillOpen && (
                  <motion.div
                    key={`drill-${line.id}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="w-full overflow-hidden"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full border-t border-amber-300/10 pt-2.5 sm:pt-4 mt-2 text-left">
                      {drillItems.map(item => (
                        <div key={item.key} className="min-w-0 rounded-lg border border-white/5 bg-black/30 p-3 flex flex-col justify-between">
                          <div className="mb-1 text-[8px] md:text-[9px] lg:text-[10px] font-semibold uppercase tracking-wide text-amber-200/90 truncate">
                            {item.label}
                          </div>
                          <p className="text-[10px] md:text-[11px] lg:text-xs font-medium leading-snug text-neutral-100 truncate" title={item.value}>
                            {item.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {expandedCuesLineId === line.id && (line.study.cues?.listeningGoalPt || line.study.cues?.mouthCuePt || line.study.cues?.preEntryCuePt) && (
                  <motion.div
                    key={`cues-${line.id}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="w-full overflow-hidden"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full border-t border-amber-300/10 pt-2.5 sm:pt-4 mt-2 text-left">
                      {line.study.cues?.listeningGoalPt && (
                        <div className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-3">
                          <div className="mb-1 flex items-center gap-1 text-[8px] md:text-[9px] lg:text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                            <Volume2 className="h-2.5 w-2.5 md:h-3 md:w-3" />
                            Ouça
                          </div>
                          <p className="text-[10px] md:text-[11px] lg:text-xs leading-normal text-neutral-200">{line.study.cues.listeningGoalPt}</p>
                        </div>
                      )}
                      {line.study.cues?.mouthCuePt && (
                        <div className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-3">
                          <div className="mb-1 flex items-center gap-1 text-[8px] md:text-[9px] lg:text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                            <Mic className="h-2.5 w-2.5 md:h-3 md:w-3" />
                            Boca
                          </div>
                          <p className="text-[10px] md:text-[11px] lg:text-xs leading-normal text-neutral-200">{line.study.cues.mouthCuePt}</p>
                        </div>
                      )}
                      {line.study.cues?.preEntryCuePt && (
                        <div className="min-w-0 rounded-lg border border-white/5 bg-black/20 p-3">
                          <div className="mb-1 flex items-center gap-1 text-[8px] md:text-[9px] lg:text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                            <Play className="h-2.5 w-2.5 md:h-3 md:w-3" />
                            Entrada
                          </div>
                          <p className="text-[10px] md:text-[11px] lg:text-xs leading-normal text-neutral-200">{line.study.cues.preEntryCuePt}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>
    );
  }, [activeLineIndex, currentTime, expandedDrillLineId, playerMode, playing, project.lines, seekToPlaybackTime, studyLoop, toggleStudyLoop, visibleLayers]);

  const renderVirtuosoItem = useCallback((idx: number, line: SongLine) => {
    return renderLine(line, activeLineIndex === idx, idx);
  }, [activeLineIndex, renderLine]);

  const playbackTime = Math.max(0, currentTime - syncOffset);
  const effectiveDuration = duration || project.metadata?.duration || 0;

  return (
    <div 
      className="flex flex-col h-[100dvh] overflow-hidden transition-colors duration-1000"
      style={{
        background: `radial-gradient(circle at 50% 0%, ${bgColor} 0%, rgba(10,10,10,1) 80%)`
      }}
    >
      {/* Header */}
      <header className="flex items-center justify-between p-2 sm:p-4 z-20 gap-2">
        <button 
          onClick={onBack}
          className="w-10 h-10 flex shrink-0 items-center justify-center bg-black/20 hover:bg-black/40 rounded-full transition-colors"
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <div className="text-center flex-1 min-w-0 flex flex-col items-center">
          <h2 className="text-white font-bold text-base sm:text-lg drop-shadow-md truncate w-full px-2">{project.metadata?.title || "Desconhecido"}</h2>
          <p className="text-neutral-400 text-xs sm:text-sm drop-shadow-md truncate w-full px-2">{project.metadata?.artist || "Desconhecido"}</p>
          {queueInfo && (
            <span className="text-[10px] sm:text-[11px] text-indigo-300 font-bold tracking-wider mt-1 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full select-none">
              {queueInfo}
            </span>
          )}
          {hasStudyLayer && (
            <div className="mt-1.5 inline-flex rounded-full border border-white/10 bg-black/20 p-0.5">
              <button
                onClick={() => handleModeChange("karaoke")}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  playerMode === "karaoke" ? "bg-white text-black" : "text-neutral-400 hover:text-white"
                )}
                title="Modo Karaokê"
              >
                <Music2 className="h-3.5 w-3.5" />
                Karaokê
              </button>
              <button
                onClick={() => handleModeChange("study")}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  playerMode === "study" ? "bg-emerald-400 text-black" : "text-neutral-400 hover:text-white"
                )}
                title="Modo Estudo"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Estudo
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-1 sm:gap-2 shrink-0">
          <button 
            onClick={() => exportService.exportJson(projectRef.current)}
            className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center bg-black/20 hover:bg-black/40 rounded-full transition-colors hidden md:flex"
            title="Exportar JSON"
          >
            <span className="text-white text-[10px] sm:text-xs font-bold font-mono">JSON</span>
          </button>
          <button 
            onClick={() => exportService.exportMarkdown(projectRef.current)}
            className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center bg-black/20 hover:bg-black/40 rounded-full transition-colors hidden md:flex"
            title="Exportar Markdown"
          >
            <Download className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center bg-black/20 hover:bg-black/40 rounded-full transition-colors"
            title="Configurações"
          >
            <Settings2 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          </button>
        </div>
      </header>

      {/* Karaoke Canvas */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center relative px-2 sm:px-4 max-w-5xl mx-auto w-full">
        {!playing && currentTime < 1 && (
           <motion.button
             initial={{ opacity: 0, scale: 0.9 }}
             animate={{ opacity: 1, scale: 1 }}
             onClick={togglePlayback}
             className="absolute z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 sm:gap-3 bg-indigo-500 hover:bg-indigo-600 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-full font-medium shadow-2xl transition-transform hover:scale-105 active:scale-95 whitespace-nowrap"
           >
             <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
             Começar a Cantar
           </motion.button>
        )}

        <AnimatePresence>
          {!isAutoScroll && (
             <motion.button
               initial={{ opacity: 0, y: 10, x: "-50%" }}
               animate={{ opacity: 1, y: 0, x: "-50%" }}
               exit={{ opacity: 0, y: 10, x: "-50%" }}
               onClick={() => setIsAutoScroll(true)}
               className="absolute z-30 bottom-12 left-1/2 flex items-center gap-2 bg-indigo-500/90 backdrop-blur border border-indigo-400/50 text-white px-5 py-2.5 rounded-full font-semibold shadow-xl hover:bg-indigo-500 transition-colors text-sm whitespace-nowrap"
             >
               <ArrowDown className="w-4 h-4 animate-bounce" />
               Acompanhar Letra
             </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div 
            key={project.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className={clsx("relative w-full h-full min-h-0 flex flex-col items-center")}
            onWheel={handleManualScroll}
            onTouchMove={handleManualScroll}
          >
             <style>{`
               .virtuoso-scroller::-webkit-scrollbar {
                 display: none;
               }
             `}</style>
             <Virtuoso
               ref={virtuosoRef}
               className="virtuoso-scroller"
               style={{ width: "100%", height: "100%", scrollbarWidth: "none", msOverflowStyle: "none" }}
               data={project.lines}
               itemContent={renderVirtuosoItem}
               components={{
                 Header: () => <div className="h-[22vh] md:h-[28vh] lg:h-[35vh]" />,
                 Footer: () => <div className="h-[22vh] md:h-[28vh] lg:h-[35vh]" />
               }}
             />
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {practiceLineIndex !== null && project.lines[practiceLineIndex] && (
          <PracticeModal
            line={project.lines[practiceLineIndex]}
            highScore={project.progress?.practiceScores?.[practiceLineIndex]?.[0]}
            onClose={() => setPracticeLineIndex(null)}
            onPlayOriginal={() => {
               const seekTime = Math.max(0, project.lines[practiceLineIndex].start - syncOffset);
               if (audioRef.current) {
                 audioRef.current.currentTime = seekTime;
                 audioRef.current.play().catch(console.error);
                 setPlaying(true);
               }
            }}
            onNext={() => {
              const nextIndex = practiceLineIndex + 1;
              if (nextIndex < project.lines.length) {
                setPracticeLineIndex(nextIndex);
              } else {
                setPracticeLineIndex(null);
              }
            }}
            onScore={(score) => {
              const baseProject = projectRef.current;
              const currentScores = baseProject.progress?.practiceScores?.[practiceLineIndex] || [];
              const updatedProject = {
                ...baseProject,
                updatedAt: new Date().toISOString(),
                progress: {
                  ...baseProject.progress,
                  practiceScores: {
                    ...(baseProject.progress?.practiceScores || {}),
                    [practiceLineIndex]: [...currentScores, score].sort((a, b) => b - a).slice(0, 5) // Keep top 5
                  }
                }
              };
              projectRef.current = updatedProject;
              projectStorage.saveProject(updatedProject).catch(console.error);
              onUpdateProjectRef.current?.(updatedProject);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedStudyToken && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl"
            >
              <button
                onClick={() => setSelectedStudyToken(null)}
                className="absolute right-4 top-4 rounded-full p-1 text-neutral-500 transition-colors hover:bg-white/10 hover:text-white"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="pr-8">
                <p className="text-xs uppercase tracking-wider text-emerald-300">Palavra</p>
                <h3 className="mt-1 text-3xl font-bold text-white">{selectedStudyToken.token.text}</h3>
                {selectedStudyToken.token.pfc && (
                  <p className="mt-1 text-xl font-semibold text-emerald-300">{selectedStudyToken.token.pfc}</p>
                )}
              </div>

              {selectedStudyToken.token.study && (
                <div className="mt-5 space-y-4">
                  {selectedStudyToken.token.study.focusSounds.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-neutral-300">
                        <Target className="h-4 w-4 text-emerald-300" />
                        Sons-alvo
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedStudyToken.token.study.focusSounds.map(sound => (
                          <span key={sound} className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-200 ring-1 ring-emerald-400/20">
                            {sound}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedStudyToken.token.study.hintPt && (
                    <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3">
                      <div className="mb-1 flex items-center gap-2 text-sm font-medium text-amber-200">
                        <ListChecks className="h-4 w-4" />
                        Dica
                      </div>
                      <p className="text-sm leading-relaxed text-amber-100">{selectedStudyToken.token.study.hintPt}</p>
                    </div>
                  )}

                  {selectedStudyToken.token.study.commonMistakesPt.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-neutral-300">
                        <AlertCircle className="h-4 w-4 text-red-300" />
                        Evite
                      </div>
                      <ul className="space-y-1.5 text-sm text-neutral-300">
                        {selectedStudyToken.token.study.commonMistakesPt.map(mistake => (
                          <li key={mistake} className="rounded-lg bg-white/[0.03] px-3 py-2">{mistake}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

       {/* Layer Settings Panel */}
       <AnimatePresence>
         {showSettings && (
           <motion.div 
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             exit={{ opacity: 0, y: 20 }}
             className="absolute bottom-16 md:bottom-24 left-2 right-2 md:left-auto md:right-4 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800 p-5 rounded-2xl shadow-2xl z-40 w-[94vw] max-w-[calc(100vw-16px)] sm:w-[480px] max-h-[70vh] overflow-y-auto"
           >
             <div className="flex items-center justify-between mb-4 md:hidden">
               <h3 className="text-white font-bold text-lg">Opções</h3>
               <button onClick={() => setShowSettings(false)} className="p-2 bg-neutral-800 rounded-full text-neutral-400">
                 <X className="w-5 h-5" />
               </button>
             </div>
             
             <div className="md:hidden flex gap-2 mb-6">
               <button
                 onClick={() => exportService.exportJson(projectRef.current)}
                 className="flex-1 bg-white/5 hover:bg-white/10 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-2"
               >
                 <span className="font-mono font-bold">JSON</span>
               </button>
               <button
                 onClick={() => exportService.exportMarkdown(projectRef.current)}
                 className="flex-1 bg-white/5 hover:bg-white/10 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-2"
               >
                 <Download className="w-4 h-4" />
                 <span>MD</span>
               </button>
             </div>

             <h3 className="text-white font-medium mb-1">Camadas (Máx 3)</h3>
             <p className="text-xs text-neutral-400 mb-3 leading-tight">O primeiro item é o foco principal.</p>
             
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6 w-full">
               {(Object.keys(LAYER_LABELS) as LayerKey[]).map(layer => {
                 const index = visibleLayers.indexOf(layer);
                 const isVisible = index !== -1;
                 const isFocus = index === 0;
                 
                 return (
                   <div 
                     key={layer} 
                     className={clsx(
                       "layer-card flex flex-row items-center justify-between gap-3 w-full min-w-0 overflow-hidden rounded-xl border p-2.5 sm:p-3 transition-all h-[48px] sm:h-[54px] shrink-0",
                       isVisible ? "border-indigo-500/30 bg-indigo-500/5" : "border-neutral-800 bg-neutral-900/50"
                     )}
                   >
                     <button
                       onClick={() => toggleLayer(layer)}
                       className="flex-1 flex flex-row items-center gap-3 transition-colors text-left min-w-0 h-full"
                     >
                       <div className={clsx(
                         "w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-all text-xs font-bold",
                         isVisible ? "bg-indigo-500 border-indigo-500 text-white" : "border-neutral-600 text-transparent"
                       )}>
                         {isVisible && (
                           <span>{index + 1}</span>
                         )}
                       </div>
                       <span className={clsx(
                         "text-sm flex-1 truncate",
                         isVisible ? "text-white font-semibold" : "text-neutral-400"
                       )}>
                         {LAYER_LABELS[layer]}
                       </span>
                     </button>
                     {isVisible && !isFocus && (
                       <button
                         onClick={() => setVisibleLayers(prev => [layer, ...prev.filter(l => l !== layer)])}
                         className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-[10px] uppercase font-bold text-neutral-200 transition-colors shrink-0"
                         title="Definir como foco"
                       >
                         Focar
                       </button>
                     )}
                     {isFocus && (
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider px-2 shrink-0">Foco</span>
                     )}
                   </div>
                 );
               })}
             </div>

            <h3 className="text-white font-medium mb-1">Sincronia Global (Offset)</h3>
            <p className="mb-3 text-xs leading-snug text-neutral-400">
              Ajusta toda a letra junto, sem alterar os timestamps salvos. Use quando tudo estiver levemente adiantado ou atrasado.
            </p>
            <div className="flex items-center gap-2 mb-6">
              <button 
                onClick={() => {
                  const newOffset = syncOffset - 0.1;
                  setSyncOffset(newOffset);
                  persistProjectUpdate({ syncOffset: newOffset });
                }}
                className="w-8 h-8 rounded bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-white"
                title="Atrasar Letra"
              >
                -
              </button>
              <div className="flex-1 text-center text-sm font-mono text-neutral-300">
                {syncOffset > 0 ? "+" : ""}{syncOffset.toFixed(1)}s
              </div>
              <button 
                onClick={() => {
                  const newOffset = syncOffset + 0.1;
                  setSyncOffset(newOffset);
                  persistProjectUpdate({ syncOffset: newOffset });
                }}
                className="w-8 h-8 rounded bg-neutral-800 hover:bg-neutral-700 flex items-center justify-center text-white"
                title="Adiantar Letra"
              >
                +
              </button>
            </div>

            <h3 className="text-white font-medium mb-4">Velocidade</h3>
            <div className="flex items-center gap-2 mb-6">
              {[0.75, 1, 1.25].map(rate => (
                <button 
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  className={clsx("flex-1 py-1.5 rounded font-medium text-sm transition-colors", playbackRate === rate ? "bg-indigo-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white")}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Equalizador Gráfico */}
            <div className="border-t border-neutral-800 pt-5 mt-5 mb-6">
              <h3 className="text-white font-medium mb-1.5 flex items-center gap-1.5">
                <Music2 className="w-4 h-4 text-indigo-400" />
                Equalizador Gráfico
              </h3>
              <p className="text-[11px] text-neutral-400 mb-4 leading-tight">
                Ajuste tons graves, médios e agudos em tempo real.
              </p>
              
              <div className="grid grid-cols-3 gap-2 bg-neutral-950/60 p-3 rounded-xl border border-neutral-800/80 mb-3">
                {/* Bass */}
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-semibold text-neutral-400 mb-1">Graves</span>
                  <div className="h-24 flex items-center justify-center relative">
                    <input 
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={bassGain}
                      onChange={(e) => handleBassChange(parseInt(e.target.value))}
                      className="accent-indigo-500 h-20 cursor-pointer"
                      style={{
                        writingMode: "bt-lr",
                        WebkitAppearance: "slider-vertical"
                      } as any}
                      title="Graves (150Hz)"
                    />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-indigo-300 mt-1">
                    {bassGain > 0 ? `+${bassGain}` : bassGain} dB
                  </span>
                  <span className="text-[8px] text-neutral-500 font-mono mt-0.5">150Hz</span>
                </div>

                {/* Mid */}
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-semibold text-neutral-400 mb-1">Médios</span>
                  <div className="h-24 flex items-center justify-center relative">
                    <input 
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={midGain}
                      onChange={(e) => handleMidChange(parseInt(e.target.value))}
                      className="accent-indigo-500 h-20 cursor-pointer"
                      style={{
                        writingMode: "bt-lr",
                        WebkitAppearance: "slider-vertical"
                      } as any}
                      title="Médios (1kHz)"
                    />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-indigo-300 mt-1">
                    {midGain > 0 ? `+${midGain}` : midGain} dB
                  </span>
                  <span className="text-[8px] text-neutral-500 font-mono mt-0.5">1kHz</span>
                </div>

                {/* Treble */}
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-semibold text-neutral-400 mb-1">Agudos</span>
                  <div className="h-24 flex items-center justify-center relative">
                    <input 
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={trebleGain}
                      onChange={(e) => handleTrebleChange(parseInt(e.target.value))}
                      className="accent-indigo-500 h-20 cursor-pointer"
                      style={{
                        writingMode: "bt-lr",
                        WebkitAppearance: "slider-vertical"
                      } as any}
                      title="Agudos (6kHz)"
                    />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-indigo-300 mt-1">
                    {trebleGain > 0 ? `+${trebleGain}` : trebleGain} dB
                  </span>
                  <span className="text-[8px] text-neutral-500 font-mono mt-0.5">6kHz</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    handleBassChange(0);
                    handleMidChange(0);
                    handleTrebleChange(0);
                  }}
                  disabled={bassGain === 0 && midGain === 0 && trebleGain === 0}
                  className="w-full bg-neutral-800 hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-neutral-800 text-neutral-300 text-[11px] py-1.5 rounded-lg font-medium transition-colors"
                >
                  Resetar Equalizador
                </button>
              </div>
            </div>

            <h3 className="text-white font-medium mb-3">Top Scores (Prática)</h3>
            <div className="space-y-2">
              {practiceScoreEntries.length > 0 ? (
                practiceScoreEntries
                  .slice(0, 5)
                  .map(([lineIdx, scores]) => {
                    const idx = parseInt(lineIdx);
                    const lineText = project.lines[idx]?.original || `Linha ${idx + 1}`;
                    return (
                      <div key={lineIdx} className="bg-neutral-800 p-2 rounded-lg text-sm">
                        <div className="text-neutral-300 truncate max-w-[200px]" title={lineText}>{lineText}</div>
                        <div className="text-emerald-400 font-bold mt-1">Score: {Math.max(...scores)}%</div>
                      </div>
                    );
                  })
              ) : (
                <p className="text-sm text-neutral-500 italic">Nenhum score ainda. Pratique uma linha para ver seu score aqui.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Audio Player and Waveform */}
      <div className="bg-neutral-900 border-t border-neutral-800 px-1.5 py-1 md:px-4 md:py-2.5 lg:px-6 lg:py-3.5 flex flex-col justify-center shrink-0 w-full relative z-20">
        {audioUrl ? (
          <div className="w-full max-w-5xl mx-auto">
            <audio 
              ref={audioRef} 
              src={audioUrl} 
              muted={muted}
              className="hidden"
              onLoadedMetadata={() => {
                const nextDuration = audioRef.current?.duration || project.metadata?.duration || 0;
                setDuration(nextDuration);
                if (audioRef.current && currentTimeRef.current > 0) {
                  audioRef.current.currentTime = currentTimeRef.current;
                }
              }}
              onDurationChange={() => {
                const nextDuration = audioRef.current?.duration || project.metadata?.duration || 0;
                setDuration(nextDuration);
              }}
              onPlay={() => {
                setPlaying(true);
                setIsAutoScroll(true);
              }}
              onPause={() => setPlaying(false)}
              onEnded={handleAudioEnded}
              onError={handleAudioError}
            />
            <div className="flex items-center gap-1.5 md:gap-2.5 rounded-lg md:rounded-xl border border-neutral-800 bg-neutral-950/95 px-1.5 py-1 md:px-3 md:py-2 shadow-lg">
              {onPrevious && (
                <button
                  onClick={onPrevious}
                  disabled={!hasPrevious}
                  className="flex h-7 w-7 md:h-9 md:w-9 lg:h-10 lg:w-10 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400 transition-all"
                  title="Música Anterior"
                >
                  <SkipBack className="h-3.5 w-3.5 md:h-4 md:w-4 lg:h-5 lg:w-5" />
                </button>
              )}
              
              <button
                onClick={togglePlayback}
                className="flex h-7 w-7 md:h-9 md:w-9 lg:h-10 lg:w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
                title={playing ? "Pausar" : "Tocar"}
              >
                {playing ? <Pause className="h-3.5 w-3.5 md:h-4 md:w-4 lg:h-5 lg:w-5 fill-current" /> : <Play className="h-3.5 w-3.5 md:h-4 md:w-4 lg:h-5 lg:w-5 fill-current ml-0.5" />}
              </button>

              {onNext && (
                <button
                  onClick={onNext}
                  disabled={!hasNext}
                  className="flex h-7 w-7 md:h-9 md:w-9 lg:h-10 lg:w-10 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400 transition-all"
                  title="Próxima Música"
                >
                  <SkipForward className="h-3.5 w-3.5 md:h-4 md:w-4 lg:h-5 lg:w-5" />
                </button>
              )}
              <div className="hidden md:block min-w-[5.8rem] text-center font-mono text-xs text-neutral-300">
                {formatClock(playbackTime)} / {formatClock(effectiveDuration)}
              </div>
              <div className="min-w-0 flex-1 px-1">
                <Waveform 
                  audioUrl={audioUrl} 
                  currentTime={playbackTime} 
                  duration={effectiveDuration || 1} 
                  onSeek={(time) => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = time;
                      setCurrentTime(time + syncOffset);
                    }
                  }} 
                />
              </div>
              <div className="min-w-[2.2rem] flex flex-col items-end justify-center font-mono text-[9px] md:hidden leading-tight text-neutral-400 select-none">
                <span className="text-neutral-200">{formatClock(playbackTime)}</span>
                <span className="text-neutral-500 opacity-70">{formatClock(effectiveDuration)}</span>
              </div>
              <div className="hidden md:flex items-center gap-2 w-24 lg:w-28">
                <button
                  onClick={() => setMuted(prev => !prev)}
                  className="flex shrink-0 items-center justify-center text-neutral-300 transition-colors hover:text-white"
                  title={muted ? "Ativar som" : "Silenciar"}
                >
                  {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input 
                  type="range" 
                  min={0} 
                  max={1} 
                  step={0.05}
                  value={muted ? 0 : volume} 
                  onChange={(e) => {
                    setMuted(false);
                    setVolume(parseFloat(e.target.value));
                  }}
                  className="flex-1 h-1.5 rounded-full appearance-none bg-neutral-800 accent-neutral-400 cursor-pointer"
                  title="Volume"
                />
              </div>
              <button
                onClick={() => {
                  if (document.fullscreenElement) {
                    document.exitFullscreen();
                  } else {
                    document.documentElement.requestFullscreen();
                  }
                }}
                className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                title="Tela Cheia"
              >
                <Maximize className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
           <div className="w-full max-w-2xl mx-auto h-12 flex items-center justify-center bg-neutral-800 rounded-full border border-neutral-700">
             <p className="text-amber-400 text-sm font-medium">
               {audioLoadState === "loading"
                 ? "Carregando audio..."
                 : audioLoadState === "error"
                   ? "Nao foi possivel carregar o audio salvo."
                   : "Projeto sem audio anexado (somente letra)."}
             </p>
           </div>
        )}
      </div>
    </div>
  );
};
