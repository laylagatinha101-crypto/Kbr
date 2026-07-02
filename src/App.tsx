import React, { useState } from 'react';
import { LibraryScreen } from './components/LibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { SongProject } from './types';
import { dbService } from './lib/db';

function App() {
  const [activeProject, setActiveProject] = useState<{ project: SongProject, audioBlob: Blob } | null>(null);
  const [queue, setQueue] = useState<SongProject[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);

  const handleAddToQueue = (project: SongProject) => {
    setQueue(prev => {
      // Allow duplicates if user wants to play same song multiple times, but index-based unique tracking
      return [...prev, project];
    });
  };

  const handleRemoveFromQueue = (projectId: string, indexToRemove?: number) => {
    setQueue(prev => {
      if (typeof indexToRemove === 'number') {
        return prev.filter((_, idx) => idx !== indexToRemove);
      }
      return prev.filter(p => p.id !== projectId);
    });
  };

  const handleClearQueue = () => {
    setQueue([]);
    setQueueIndex(-1);
  };

  const handlePlayQueue = async (startIndex: number) => {
    if (queue.length === 0 || startIndex < 0 || startIndex >= queue.length) return;
    const project = queue[startIndex];
    if (!project.audioBlobId) return;
    
    try {
      const blob = await dbService.getAudioBlob(project.audioBlobId);
      if (blob) {
        setQueueIndex(startIndex);
        setActiveProject({ project, audioBlob: blob });
      }
    } catch (err) {
      console.error('Failed to play queue item', err);
    }
  };

  const handleNextSong = async () => {
    if (queueIndex < 0 || queueIndex >= queue.length - 1) return;
    const nextIndex = queueIndex + 1;
    const nextProject = queue[nextIndex];
    if (!nextProject.audioBlobId) return;

    try {
      const blob = await dbService.getAudioBlob(nextProject.audioBlobId);
      if (blob) {
        setQueueIndex(nextIndex);
        setActiveProject({ project: nextProject, audioBlob: blob });
      }
    } catch (err) {
      console.error('Failed to auto-play next song', err);
    }
  };

  const handlePreviousSong = async () => {
    if (queueIndex <= 0) return;
    const prevIndex = queueIndex - 1;
    const prevProject = queue[prevIndex];
    if (!prevProject.audioBlobId) return;

    try {
      const blob = await dbService.getAudioBlob(prevProject.audioBlobId);
      if (blob) {
        setQueueIndex(prevIndex);
        setActiveProject({ project: prevProject, audioBlob: blob });
      }
    } catch (err) {
      console.error('Failed to play previous song', err);
    }
  };

  const handleOpenProject = (project: SongProject, audioBlob: Blob) => {
    // If this project is played directly, check if it's in the queue
    const indexInQueue = queue.findIndex(p => p.id === project.id);
    setQueueIndex(indexInQueue);
    setActiveProject({ project, audioBlob });
  };

  const hasNext = queueIndex >= 0 && queueIndex < queue.length - 1;
  const hasPrevious = queueIndex > 0;
  const queueInfo = queueIndex >= 0 
    ? `Fila: ${queueIndex + 1} de ${queue.length}` 
    : undefined;

  return (
    <>
      {!activeProject ? (
        <LibraryScreen 
          onOpenProject={handleOpenProject} 
          queue={queue}
          onAddToQueue={handleAddToQueue}
          onRemoveFromQueue={handleRemoveFromQueue}
          onClearQueue={handleClearQueue}
          onPlayQueue={handlePlayQueue}
        />
      ) : (
        <PlayerScreen 
          project={activeProject.project} 
          audioBlob={activeProject.audioBlob} 
          onBack={() => setActiveProject(null)} 
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          onNext={hasNext ? handleNextSong : undefined}
          onPrevious={hasPrevious ? handlePreviousSong : undefined}
          queueInfo={queueInfo}
        />
      )}
    </>
  );
}

export default App;
//
