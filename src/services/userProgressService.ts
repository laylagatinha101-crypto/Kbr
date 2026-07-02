import { UserProgressItem, PracticeAttempt, UserProgressStore, PracticeItemType, PracticeMode, PracticeStatus } from '../types';
import { dbService } from '../lib/db';

const PROGRESS_STORE_KEY = 'user_progress_store';

function scheduleReview(
  rating: 1 | 2 | 3 | 4,
  item?: UserProgressItem
): {
  easeFactor: number;
  intervalDays: number;
  dueAt: string;
  status: PracticeStatus;
} {
  let easeFactor = item?.easeFactor ?? 2.5;
  let intervalDays = item?.intervalDays ?? 0;

  if (rating === 1) {
    intervalDays = 0;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
  } else if (rating === 2) {
    intervalDays = 1;
    easeFactor = Math.max(1.3, easeFactor - 0.15);
  } else if (rating === 3) {
    if (intervalDays === 0) intervalDays = 3;
    else intervalDays = Math.max(3, intervalDays * easeFactor);
    easeFactor += 0.1;
  } else if (rating === 4) {
    if (intervalDays === 0) intervalDays = 7;
    else intervalDays = Math.max(7, intervalDays * easeFactor * 1.3);
    easeFactor += 0.15;
  }

  const status: PracticeStatus = rating <= 2 ? 'learning' : (intervalDays > 21 && item?.correctAttempts && item.correctAttempts > 5 ? 'mastered' : 'review');
  
  const now = new Date();
  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString();

  return {
    easeFactor,
    intervalDays,
    dueAt,
    status
  };
}

class UserProgressService {
  private store: UserProgressStore | null = null;

  async loadStore(): Promise<UserProgressStore> {
    if (this.store) return this.store;
    
    try {
      const res = await fetch('/api/user-progress');
      if (res.ok) {
        this.store = await res.json();
        return this.store!;
      }
    } catch (e) {
      // API not available, fallback to indexedDB
    }

    const localData = await dbService.getSetting<UserProgressStore>(PROGRESS_STORE_KEY);
    if (localData) {
      this.store = localData;
    } else {
      this.store = { version: 1, items: [], attempts: [] };
    }
    
    return this.store;
  }

  async saveStore(store: UserProgressStore): Promise<void> {
    this.store = store;
    
    try {
      const res = await fetch('/api/user-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(store)
      });
      if (res.ok) return;
    } catch (e) {
      // API not available, fallback to indexedDB
    }

    await dbService.saveSetting(PROGRESS_STORE_KEY, store);
  }

  async registerAttempt(attempt: Omit<PracticeAttempt, 'id' | 'createdAt'>, skillFocus: string[], difficulty: 'easy'|'medium'|'hard'): Promise<void> {
    const store = await this.loadStore();
    
    const newAttempt: PracticeAttempt = {
      ...attempt,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    
    store.attempts.push(newAttempt);

    if (attempt.selfRating) {
      const existingItemIndex = store.items.findIndex(
        i => i.projectId === attempt.projectId && i.lineId === attempt.lineId && i.tokenId === attempt.tokenId
      );

      let item = existingItemIndex >= 0 ? store.items[existingItemIndex] : undefined;
      const reviewResult = scheduleReview(attempt.selfRating, item);

      if (item) {
        item.attempts += 1;
        if (attempt.selfRating >= 3) item.correctAttempts += 1;
        item.lastScore = attempt.score;
        if (attempt.score && (!item.bestScore || attempt.score > item.bestScore)) {
          item.bestScore = attempt.score;
        }
        item.easeFactor = reviewResult.easeFactor;
        item.intervalDays = reviewResult.intervalDays;
        item.dueAt = reviewResult.dueAt;
        item.status = reviewResult.status;
        item.lastReviewedAt = new Date().toISOString();
        item.updatedAt = new Date().toISOString();
        store.items[existingItemIndex] = item;
      } else {
        const newItem: UserProgressItem = {
          id: crypto.randomUUID(),
          projectId: attempt.projectId,
          lineId: attempt.lineId,
          tokenId: attempt.tokenId,
          type: attempt.tokenId ? 'token' : 'line',
          skillFocus,
          difficulty,
          attempts: 1,
          correctAttempts: attempt.selfRating >= 3 ? 1 : 0,
          lastScore: attempt.score,
          bestScore: attempt.score,
          easeFactor: reviewResult.easeFactor,
          intervalDays: reviewResult.intervalDays,
          dueAt: reviewResult.dueAt,
          status: reviewResult.status,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastReviewedAt: new Date().toISOString()
        };
        store.items.push(newItem);
      }
    }

    await this.saveStore(store);
  }

  async getProjectSummary(projectId: string) {
    const store = await this.loadStore();
    const items = store.items.filter(i => i.projectId === projectId && i.type === 'line');
    
    const totalPracticed = items.length;
    const now = new Date().toISOString();
    const dueToday = items.filter(i => i.dueAt <= now).length;
    
    let bestScore = 0;
    items.forEach(i => {
      if (i.bestScore && i.bestScore > bestScore) bestScore = i.bestScore;
    });

    let overallStatus: PracticeStatus = 'new';
    if (items.some(i => i.dueAt <= now)) overallStatus = 'review';
    else if (items.length > 0) overallStatus = 'learning';

    return {
      totalPracticed,
      dueToday,
      bestScore,
      overallStatus
    };
  }

  async getDueReviews() {
    const store = await this.loadStore();
    const now = new Date().toISOString();
    return store.items.filter(i => i.dueAt <= now);
  }
}

export const userProgressService = new UserProgressService();
