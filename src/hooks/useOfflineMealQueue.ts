import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MealItem, MealType } from "@/shared/schemas";
import { useCreateMeal } from "@/hooks/useMeals";
import { useAuth } from "@/providers/AuthProvider";
import { captureClientError } from "@/lib/monitoring";

const OFFLINE_MEAL_QUEUE_KEY = "offline_meal_queue_v1";

export type QueuedMealLog = {
  id: string;
  mealType: MealType;
  items: MealItem[];
  date: string;
  requestId: string;
  createdAt: string;
  retryCount: number;
  lastError: string | null;
};

function parseQueue(raw: string | null) {
  if (!raw) return [] as QueuedMealLog[];

  try {
    const parsed = JSON.parse(raw) as QueuedMealLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readQueue() {
  const raw = await AsyncStorage.getItem(OFFLINE_MEAL_QUEUE_KEY);
  return parseQueue(raw);
}

async function writeQueue(queue: QueuedMealLog[]) {
  await AsyncStorage.setItem(OFFLINE_MEAL_QUEUE_KEY, JSON.stringify(queue));
}

export function isLikelyOfflineError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(network|fetch|internet|offline|timed? out|connection)/i.test(message);
}

export async function enqueueOfflineMealLog(payload: Omit<QueuedMealLog, "id" | "createdAt" | "retryCount" | "lastError">) {
  const queue = await readQueue();
  const next: QueuedMealLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
    ...payload
  };

  queue.push(next);
  await writeQueue(queue);
  return next;
}

export async function getOfflineMealQueueLength() {
  const queue = await readQueue();
  return queue.length;
}

export function useOfflineMealQueueSync() {
  const { user } = useAuth();
  const createMeal = useCreateMeal();

  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    const count = await getOfflineMealQueueLength();
    setPendingCount(count);
  }, []);

  const syncNow = useCallback(async () => {
    if (!user || createMeal.isPending || isSyncing) return;

    setIsSyncing(true);

    try {
      const queue = await readQueue();
      const remaining: QueuedMealLog[] = [];

      for (const entry of queue) {
        try {
          await createMeal.mutateAsync({
            mealType: entry.mealType,
            items: entry.items,
            date: entry.date,
            requestId: entry.requestId
          });
        } catch (error) {
          remaining.push({
            ...entry,
            retryCount: entry.retryCount + 1,
            lastError: error instanceof Error ? error.message : "sync_failed"
          });
          void captureClientError(error, { scope: "offline-queue-sync" });
        }
      }

      await writeQueue(remaining);
      setPendingCount(remaining.length);
    } finally {
      setIsSyncing(false);
    }
  }, [createMeal, isSyncing, user]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    if (!user) return;
    void syncNow();
  }, [syncNow, user]);

  return {
    pendingCount,
    isSyncing,
    syncNow,
    refreshCount
  };
}
