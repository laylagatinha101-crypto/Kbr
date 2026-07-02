import React, { useRef, useState, useEffect } from "react";

export const Waveform: React.FC<{ audioUrl: string | null, currentTime: number, duration: number, onSeek: (time: number) => void }> = React.memo(({ audioUrl, currentTime, duration, onSeek }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isDecoding, setIsDecoding] = useState(false);

  useEffect(() => {
    if (!audioUrl) {
      setPeaks([]);
      return;
    }
    let isCancelled = false;
    let ctx: AudioContext | null = null;
    
    const decodeAudio = async () => {
      try {
        setIsDecoding(true);
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new AudioContextCtor();
        const res = await fetch(audioUrl);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        
        if (isCancelled) return;
        
        const channelData = buffer.getChannelData(0);
        const numBars = 150;
        const step = Math.ceil(channelData.length / numBars);
        const newPeaks = [];
        
        for (let i = 0; i < numBars; i++) {
          let max = 0;
          for (let j = 0; j < step; j++) {
            const idx = i * step + j;
            if (idx < channelData.length) {
              const val = Math.abs(channelData[idx]);
              if (val > max) max = val;
            }
          }
          newPeaks.push(max);
        }
        setPeaks(newPeaks);
      } catch (err) {
        console.error("Error decoding audio for waveform", err);
      } finally {
        if (!isCancelled) setIsDecoding(false);
      }
    };
    
    decodeAudio();
    return () => {
      isCancelled = true;
      ctx?.close().catch(console.error);
    };
  }, [audioUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    
    ctx.clearRect(0, 0, width, height);
    
    const barWidth = width / peaks.length;
    const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const activeIdx = Math.floor(progress * peaks.length);
    
    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i];
      const barHeight = Math.max(2, peak * height * 0.8);
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      
      if (i < activeIdx) {
        ctx.fillStyle = "#6366f1"; // indigo-500
      } else {
        ctx.fillStyle = "#3f3f46"; // neutral-700
      }
      
      ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
    }
  }, [peaks, currentTime, duration]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    if (duration > 0) onSeek(progress * duration);
  };

  return (
    <div className="w-full h-9 sm:h-10 relative flex items-center bg-neutral-950 rounded-lg border border-neutral-800 overflow-hidden cursor-pointer" title="Forma de Onda">
      {isDecoding && peaks.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
          Gerando forma de onda...
        </div>
      ) : null}
      <canvas 
        ref={canvasRef} 
        className="w-full h-full" 
        onClick={handleCanvasClick}
      />
    </div>
  );
});
