import React, { useState } from 'react';
import { LibraryScreen } from './components/LibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { SongProject } from './types';
import { dbService } from './lib/db';

function App() {
  const [activeProject, setActiveProject] = useState<{ project: SongProject, audioBlob: Blob, initialPracticeLineId?: string } | null>(null);
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

  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [smartReviewQueue, setSmartReviewQueue] = useState<{ projectId: string; lineId: string }[] | null>(null);
  const [smartReviewIndex, setSmartReviewIndex] = useState<number>(-1);

  const handleStartSmartReview = async (dueItems: { projectId: string; lineId: string }[]) => {
    if (dueItems.length === 0) return;
    setSmartReviewQueue(dueItems);
    setSmartReviewIndex(0);
    
    const firstItem = dueItems[0];
    const allProjects = await dbService.getAllProjects();
    const project = allProjects.find(p => p.id === firstItem.projectId);
    if (project && project.audioBlobId) {
      const blob = await dbService.getAudioBlob(project.audioBlobId);
      if (blob) {
        setShouldAutoplay(true);
        setActiveProject({ project, audioBlob: blob, initialPracticeLineId: firstItem.lineId });
      }
    }
  };

  const handleNextSmartReview = async () => {
    if (!smartReviewQueue || smartReviewIndex < 0 || smartReviewIndex >= smartReviewQueue.length - 1) {
      setSmartReviewQueue(null);
      setSmartReviewIndex(-1);
      setActiveProject(null);
      return;
    }
    
    const nextIndex = smartReviewIndex + 1;
    setSmartReviewIndex(nextIndex);
    const nextItem = smartReviewQueue[nextIndex];
    
    const allProjects = await dbService.getAllProjects();
    const project = allProjects.find(p => p.id === nextItem.projectId);
    if (project && project.audioBlobId) {
      const blob = await dbService.getAudioBlob(project.audioBlobId);
      if (blob) {
        setShouldAutoplay(true);
        setActiveProject({ project, audioBlob: blob, initialPracticeLineId: nextItem.lineId });
      }
    }
  };

  const handlePrevSmartReview = async () => {
    if (!smartReviewQueue || smartReviewIndex <= 0) return;
    const prevIndex = smartReviewIndex - 1;
    setSmartReviewIndex(prevIndex);
    const prevItem = smartReviewQueue[prevIndex];
    
    const allProjects = await dbService.getAllProjects();
    const project = allProjects.find(p => p.id === prevItem.projectId);
    if (project && project.audioBlobId) {
      const blob = await dbService.getAudioBlob(project.audioBlobId);
      if (blob) {
        setShouldAutoplay(true);
        setActiveProject({ project, audioBlob: blob, initialPracticeLineId: prevItem.lineId });
      }
    }
  };

  const handleBackFromPlayer = () => {
    setSmartReviewQueue(null);
    setSmartReviewIndex(-1);
    setActiveProject(null);
  };

  const handleUpdateProject = (updatedProject: SongProject) => {
    setActiveProject(prev => prev ? { ...prev, project: updatedProject } : null);
    setQueue(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
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
        setShouldAutoplay(true);
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
        setShouldAutoplay(true);
        setActiveProject({ project: prevProject, audioBlob: blob });
      }
    } catch (err) {
      console.error('Failed to play previous song', err);
    }
  };

  const handleOpenProject = (project: SongProject, audioBlob: Blob, initialPracticeLineId?: string) => {
    // If this project is played directly, check if it's in the queue
    const indexInQueue = queue.findIndex(p => p.id === project.id);
    setQueueIndex(indexInQueue);
    setShouldAutoplay(false);
    setActiveProject({ project, audioBlob, initialPracticeLineId });
  };


  const isSmartReviewing = smartReviewQueue !== null && smartReviewIndex >= 0;

  const hasNext = isSmartReviewing
    ? smartReviewIndex < smartReviewQueue.length - 1
    : (queueIndex >= 0 && queueIndex < queue.length - 1);

  const hasPrevious = isSmartReviewing
    ? smartReviewIndex > 0
    : queueIndex > 0;

  const queueInfo = isSmartReviewing
    ? `Treino: ${smartReviewIndex + 1} de ${smartReviewQueue.length}`
    : (queueIndex >= 0 
        ? `Fila: ${queueIndex + 1} de ${queue.length}` 
        : undefined);

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
          onStartSmartReview={handleStartSmartReview}
        />
      ) : (
        <PlayerScreen 
          project={activeProject.project} 
          audioBlob={activeProject.audioBlob} 
          onBack={handleBackFromPlayer} 
          onUpdateProject={handleUpdateProject}
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          onNext={isSmartReviewing ? handleNextSmartReview : (hasNext ? handleNextSong : undefined)}
          onPrevious={isSmartReviewing ? handlePrevSmartReview : (hasPrevious ? handlePreviousSong : undefined)}
          queueInfo={queueInfo}
          shouldAutoplay={shouldAutoplay}
          initialPracticeLineId={activeProject.initialPracticeLineId}
          smartReviewQueue={smartReviewQueue || undefined}
          smartReviewIndex={smartReviewIndex >= 0 ? smartReviewIndex : undefined}
          onNextSmartReview={isSmartReviewing ? handleNextSmartReview : undefined}
          onPrevSmartReview={isSmartReviewing ? handlePrevSmartReview : undefined}
        />
      )}
    </>
  );
}

export default App;
//
