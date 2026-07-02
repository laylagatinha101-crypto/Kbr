import { useState, useEffect, useCallback } from 'react';
import { userProgressService } from '../services/userProgressService';
import { UserProgressStore, PracticeAttempt } from '../types';

export function useUserProgress() {
  const [progress, setProgress] = useState<UserProgressStore | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProgress = useCallback(async () => {
    setLoading(true);
    try {
      const data = await userProgressService.loadStore();
      setProgress(data);
    } catch (e) {
      console.error("Failed to load user progress", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

  const registerAttempt = useCallback(async (attempt: Omit<PracticeAttempt, 'id' | 'createdAt'>, skillFocus: string[], difficulty: 'easy'|'medium'|'hard') => {
    await userProgressService.registerAttempt(attempt, skillFocus, difficulty);
    await refreshProgress();
  }, [refreshProgress]);

  const getProjectSummary = useCallback(async (projectId: string) => {
    return await userProgressService.getProjectSummary(projectId);
  }, []);

  const getDueReviews = useCallback(async () => {
    return await userProgressService.getDueReviews();
  }, []);

  return {
    progress,
    loading,
    registerAttempt,
    getProjectSummary,
    getDueReviews,
    refreshProgress
  };
}
