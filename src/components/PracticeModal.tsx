import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, X, Play, RotateCcw, ArrowRight, CheckCircle2, AlertCircle, Volume2, Award } from "lucide-react";
import { SongLine } from "../types";

const normalizationsMap: Record<string, string[]> = {
  // Gírias comuns (Slang)
  "gonna": ["going", "to"],
  "wanna": ["want", "to"],
  "gotta": ["got", "to"],
  "aint": ["am", "not", "is", "not", "are", "not", "has", "not", "have", "not"],
  "kinda": ["kind", "of"],
  "sorta": ["sort", "of"],
  "lemme": ["let", "me"],
  "gimme": ["give", "me"],
  "outta": ["out", "of"],
  "cause": ["because"],
  "cuz": ["because"],
  "cos": ["because"],
  "yall": ["you", "all"],

  // Contrações negativas
  "dont": ["do", "not"],
  "wont": ["will", "not"],
  "cant": ["cannot", "can", "not"],
  "isnt": ["is", "not"],
  "arent": ["are", "not"],
  "wasnt": ["was", "not"],
  "werent": ["were", "not"],
  "hasnt": ["has", "not"],
  "havent": ["have", "not"],
  "hadnt": ["had", "not"],
  "doesnt": ["does", "not"],
  "didnt": ["did", "not"],
  "shouldnt": ["should", "not"],
  "couldnt": ["could", "not"],
  "wouldnt": ["would", "not"],

  // Verbos "To Be" e "To Have" ('s, 'm, 're, 've)
  "its": ["it", "is"],
  "hes": ["he", "is"],
  "shes": ["she", "is"],
  "thats": ["that", "is"],
  "whats": ["what", "is"],
  "whos": ["who", "is"],
  "theres": ["there", "is"],
  "im": ["i", "am"],
  "youre": ["you", "are"],
  "theyre": ["they", "are"],
  "were": ["we", "are"],
  "ive": ["i", "have"],
  "youve": ["you", "have"],
  "theyve": ["they", "have"],
  "weve": ["we", "have"],
  "wouldve": ["would", "have"],
  "couldve": ["could", "have"],
  "shouldve": ["should", "have"],

  // Futuro e Condicionais ('ll, 'd)
  "ill": ["i", "will"],
  "youll": ["you", "will"],
  "hell": ["he", "will"],
  "shell": ["she", "will"],
  "theyll": ["they", "will"],
  "well": ["we", "will"],
  "therell": ["there", "will"],
  "id": ["i", "would", "i", "had"],
  "youd": ["you", "would", "you", "had"],
  "hed": ["he", "would", "he", "had"],
  "shed": ["she", "would", "she", "had"],
  "wed": ["we", "would", "we", "had"],
  "theyd": ["they", "would", "they", "had"],
};

const getLevenshteinDistance = (s1: string, s2: string): number => {
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
};

const areWordsSimilar = (w1: string, w2: string): { matches: boolean; exact: boolean } => {
  const n1 = w1.toLowerCase().replace(/[^\w]/g, "");
  const n2 = w2.toLowerCase().replace(/[^\w]/g, "");
  
  if (!n1 || !n2) return { matches: false, exact: false };
  if (n1 === n2) return { matches: true, exact: true };
  
  const eq1 = normalizationsMap[n1];
  if (eq1 && eq1.some(val => val === n2)) return { matches: true, exact: true };
  
  const eq2 = normalizationsMap[n2];
  if (eq2 && eq2.some(val => val === n1)) return { matches: true, exact: true };

  const maxLen = Math.max(n1.length, n2.length);
  const dist = getLevenshteinDistance(n1, n2);
  const similarity = 1 - dist / maxLen;

  if (similarity >= 0.75) {
    return { matches: true, exact: false };
  }

  return { matches: false, exact: false };
};

interface WordStatus {
  word: string;
  originalIndex: number;
  status: "correct" | "partial" | "missed";
  spokenWord?: string;
}

const alignSentences = (originalStr: string, spokenStr: string): WordStatus[] => {
  const originalWords = originalStr.split(/\s+/).filter(Boolean);
  const normSpokenWords = spokenStr
    .toLowerCase()
    .replace(/[^\w\s]|_/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const statusList: WordStatus[] = originalWords.map((word, index) => ({
    word,
    originalIndex: index,
    status: "missed"
  }));

  let spokenIndex = 0;
  for (let i = 0; i < statusList.length; i++) {
    const origWord = statusList[i].word;
    const cleanOrig = origWord.toLowerCase().replace(/[^\w]|_/g, "");
    if (!cleanOrig) continue;

    let found = false;
    for (let lookAhead = 0; lookAhead < 3; lookAhead++) {
      const idx = spokenIndex + lookAhead;
      if (idx < normSpokenWords.length) {
        const spokenWord = normSpokenWords[idx];
        const { matches, exact } = areWordsSimilar(cleanOrig, spokenWord);
        if (matches) {
          statusList[i].status = exact ? "correct" : "partial";
          statusList[i].spokenWord = spokenWord;
          spokenIndex = idx + 1;
          found = true;
          break;
        }
      }
    }
  }

  return statusList;
};

const accuracyScoreFromSpoken = (spoken: string, original: string) => {
  if (!spoken) return 0;
  const currentAlignment = alignSentences(original, spoken);
  const total = currentAlignment.length;
  if (total === 0) return 0;
  
  let scorePoints = 0;
  currentAlignment.forEach(item => {
    if (item.status === "correct") scorePoints += 1.0;
    else if (item.status === "partial") scorePoints += 0.7;
  });
  
  return Math.round((scorePoints / total) * 100);
};

interface PracticeModalProps {
  line: SongLine;
  highScore?: number;
  onClose: () => void;
  onPlayOriginal: () => void;
  onNext: () => void;
  onSelfRate?: (rating: 1 | 2 | 3 | 4) => void;
  onScore: (score: number) => void;
}

export const PracticeModal: React.FC<PracticeModalProps> = ({ 
  line, 
  highScore, 
  onClose, 
  onPlayOriginal, 
  onNext,
  onSelfRate,
  onScore 
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState<"success" | "partial" | "poor" | null>(null);
  const [volumes, setVolumes] = useState<number[]>(new Array(20).fill(0));
  const [isSupported, setIsSupported] = useState(true);
  const [rateFeedback, setRateFeedback] = useState<string | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.lang = "en-US";
      recognition.interimResults = true;
      
      recognition.onresult = (event: any) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const currentTranscript = finalTranscript || interimTranscript;
        if (currentTranscript) {
          setTranscript(currentTranscript);
          const isFinal = event.results[event.results.length - 1].isFinal;
          analyzePronunciation(currentTranscript, line.original, isFinal);
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        stopRecording();
      };

      recognition.onend = () => {
        stopRecording();
      };

      recognitionRef.current = recognition;
      setIsSupported(true);
    } else {
      setIsSupported(false);
    }

    return () => {
      stopRecording();
      window.speechSynthesis.cancel();
    };
  }, [line]);

  const playSuccessSound = (score: number) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playNote = (freq: number, startTime: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, startTime);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = audioCtx.currentTime;
      if (score === 100) {
        playNote(523.25, now, 0.4);       // C5
        playNote(659.25, now + 0.1, 0.4); // E5
        playNote(783.99, now + 0.2, 0.4); // G5
        playNote(1046.50, now + 0.3, 0.6); // C6
      } else if (score >= 70) {
        playNote(392.00, now, 0.3);       // G4
        playNote(523.25, now + 0.15, 0.5); // C5
      }
    } catch (e) {
      console.error("Failed to play sound feedback", e);
    }
  };

  const analyzePronunciation = (spoken: string, original: string, isFinal = true) => {
    const finalScore = accuracyScoreFromSpoken(spoken, original);
    
    if (isFinal) {
      onScore(finalScore);
      
      if (finalScore >= 70) {
        setFeedback("success");
        playSuccessSound(finalScore);
      } else if (finalScore >= 40) {
        setFeedback("partial");
      } else {
        setFeedback("poor");
      }
    }
  };

  const startVisualizer = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      
      const analyzer = audioCtx.createAnalyser();
      analyzer.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyzer);
      analyzerRef.current = analyzer;

      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      
      const updateVisualizer = () => {
        if (!analyzerRef.current) return;
        analyzerRef.current.getByteFrequencyData(dataArray);
        
        const newVolumes = Array.from(dataArray).slice(0, 20).map(v => v / 255);
        setVolumes(newVolumes);
        
        // @ts-ignore
        animationFrameRef.current = requestAnimationFrame(updateVisualizer);
      };
      
      updateVisualizer();
    } catch (e) {
      console.error("Audio visualizer error", e);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e){}
    }
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
    }
    setVolumes(new Array(20).fill(0));
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      setTranscript("");
      setFeedback(null);
      try {
        recognitionRef.current?.start();
        setIsRecording(true);
        startVisualizer();
      } catch (e) {
        console.error(e);
        alert("Erro ao acessar o microfone. Verifique as permissões.");
      }
    }
  };

  const playAiGuide = () => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line.original);
    utterance.lang = "en-US";
    utterance.rate = 0.75;
    window.speechSynthesis.speak(utterance);
  };

  const accuracyScore = () => {
    return accuracyScoreFromSpoken(transcript, line.original);
  };

  const alignment = alignSentences(line.original, transcript);

  const handleRate = (rating: 1 | 2 | 3 | 4) => {
    if (onSelfRate) onSelfRate(rating);
    setRateFeedback("Registrado!");
    setTimeout(() => {
      setRateFeedback(null);
      onNext();
    }, 1200);
  };

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer"
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-[400px] bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 shadow-2xl relative cursor-default"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-4">
          <h3 className="text-lg font-bold text-white flex items-center justify-center gap-2">
            Modo de Prática
            <button 
              onClick={playAiGuide}
              className="p-1.5 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 rounded-full transition-colors"
              title="Guia IA (Pronúncia Lenta)"
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>
          </h3>
          
          {highScore !== undefined && highScore > 0 && (
            <div className="flex items-center justify-center gap-1 mt-1.5 text-[10px] text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded-full w-fit mx-auto border border-amber-500/20 uppercase tracking-widest">
              <Award className="w-3 h-3" />
              <span>Recorde: {highScore}%</span>
            </div>
          )}
        </div>

        <div className="space-y-2.5 mb-5 text-center bg-black/40 p-4 rounded-xl border border-white/5 backdrop-blur-md">
          <div className="flex flex-wrap justify-center gap-x-1.5 gap-y-1 text-center py-1">
            {alignment.map((item, idx) => (
              <span
                key={idx}
                className={`text-xl sm:text-2xl font-bold transition-colors ${
                  !transcript 
                    ? "text-white" 
                    : item.status === "correct" 
                      ? "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.35)]" 
                      : item.status === "partial" 
                        ? "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.35)]" 
                        : "text-neutral-600"
                }`}
              >
                {item.word}
              </span>
            ))}
          </div>
          {line.pfc && (
            <div className="text-base sm:text-lg text-emerald-400 font-bold tracking-wide">
              {line.pfc}
            </div>
          )}
          {line.translationPt && (
            <div className="text-sm sm:text-base text-sky-200/90 font-medium pt-2 border-t border-white/5">
              {line.translationPt}
            </div>
          )}
        </div>

        {!isSupported ? (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 text-xs text-center mb-5 flex flex-col items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-400 animate-pulse" />
            <p className="font-bold">Navegador não suportado</p>
            <p className="text-amber-300/80 leading-relaxed">
              O recurso de Reconhecimento de Voz não é suportado pelo seu navegador atual. Recomendamos o uso do Google Chrome ou Safari para praticar.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center mb-5 gap-3">
            <button
              onClick={toggleRecording}
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all z-10 relative ${
                isRecording 
                  ? "bg-red-500 text-white" 
                  : "bg-indigo-500 hover:bg-indigo-600 hover:scale-105 text-white"
              }`}
            >
              <Mic className={`w-6 h-6 ${isRecording ? "animate-bounce" : ""}`} />
            </button>
            
            <div className="flex items-end justify-center gap-1 h-8 w-full max-w-[160px]">
              {volumes.map((v, i) => (
                <motion.div
                  key={i}
                  className="w-full bg-indigo-400 rounded-t-sm"
                  animate={{ height: `${Math.max(4, v * 100)}%` }}
                  transition={{ type: "tween", duration: 0.05 }}
                />
              ))}
            </div>
          </div>
        )}

        <AnimatePresence>
          {transcript && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 p-3 bg-black/30 rounded-xl text-center"
            >
              <p className="text-xs text-neutral-400 mb-0.5">Você disse:</p>
              <p className="text-base text-white font-medium">"{transcript}"</p>
              
              {feedback && (
                <div className="mt-2.5 flex flex-col items-center justify-center gap-1">
                  <div className={`flex items-center justify-center gap-1.5 text-xs font-bold ${
                    feedback === "success" ? "text-green-400" :
                    feedback === "partial" ? "text-amber-400" :
                    "text-red-400"
                  }`}>
                    {feedback === "success" && <><CheckCircle2 className="w-4 h-4" /> Excelente pronúncia!</>}
                    {feedback === "partial" && <><AlertCircle className="w-4 h-4" /> Bom, mas pode melhorar!</>}
                    {feedback === "poor" && <><X className="w-4 h-4" /> Tente novamente!</>}
                  </div>
                  <span className="text-[10px] text-neutral-500 font-mono tracking-widest uppercase mt-0.5">
                    Pontuação: {accuracyScore()}%
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-3 gap-2">
          <button 
            onClick={onPlayOriginal}
            className="flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors text-white text-xs font-semibold"
          >
            <Play className="w-4 h-4" /> Ouvir
          </button>
          <button 
            onClick={() => { setTranscript(""); setFeedback(null); }}
            className="flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors text-white text-xs font-semibold"
          >
            <RotateCcw className="w-4 h-4" /> Resetar
          </button>
          <button 
            onClick={onNext}
            className="flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-300 transition-colors text-xs font-semibold"
          >
            <ArrowRight className="w-4 h-4" /> Próxima
          </button>
        </div>

        {onSelfRate && (
          <div className="mt-5 pt-4 border-t border-white/10 relative">
            {rateFeedback ? (
              <div className="flex flex-col items-center justify-center py-3 animate-in fade-in zoom-in duration-300">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mb-1" />
                <p className="text-sm font-bold text-emerald-400">{rateFeedback}</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-neutral-400 text-center mb-2.5">Autoavaliação (Revisão Espaçada)</p>
                <div className="grid grid-cols-4 gap-1.5">
                  <button onClick={() => handleRate(1)} className="py-2 text-[11px] font-bold rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">Errei</button>
                  <button onClick={() => handleRate(2)} className="py-2 text-[11px] font-bold rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors">Quase</button>
                  <button onClick={() => handleRate(3)} className="py-2 text-[11px] font-bold rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors">Acertei</button>
                  <button onClick={() => handleRate(4)} className="py-2 text-[11px] font-bold rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors">Fácil</button>
                </div>
              </>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};
