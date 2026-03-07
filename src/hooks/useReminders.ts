import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { clampToQuietHours, fromMinutes, toMinutes } from "@/lib/nutritionInsights";
import { useAuth } from "@/providers/AuthProvider";
import type { MealType } from "@/shared/schemas";
import { cacheQueryData, runResilientQuery } from "@/lib/resilientQuery";

export type ReminderPreferences = {
  user_id: string;
  enabled: boolean;
  timezone_name: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  breakfast_enabled: boolean;
  lunch_enabled: boolean;
  dinner_enabled: boolean;
  snack_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type SmartReminder = {
  mealType: MealType;
  time: string;
};

const defaultTimes: Record<MealType, string> = {
  breakfast: "08:00",
  lunch: "13:00",
  dinner: "19:00",
  snack: "16:00"
};

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export function useReminderPreferences() {
  const { user } = useAuth();
  const queryKey = ["reminder-preferences", user?.id] as const;

  return useQuery({
    queryKey,
    queryFn: async () => {
      if (!user) return null as ReminderPreferences | null;
      return runResilientQuery({
        queryKey,
        mode: "cache-first",
        maxAgeMs: 1000 * 60 * 10,
        queryFn: async () => {
          const supabase = getSupabaseClient();
          const { data, error } = await supabase
            .from("reminder_preferences")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();

          if (error) throw error;

          if (!data) {
            const { data: created, error: createError } = await supabase
              .from("reminder_preferences")
              .insert({
                user_id: user.id,
                timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
              })
              .select("*")
              .single();

            if (createError) throw createError;
            return created as ReminderPreferences;
          }

          return data as ReminderPreferences;
        }
      });
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 10
  });
}

export function useUpdateReminderPreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<ReminderPreferences>) => {
      if (!user) throw new Error("Not authenticated");

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("reminder_preferences")
        .upsert(
          {
            user_id: user.id,
            ...updates
          },
          { onConflict: "user_id" }
        )
        .select("*")
        .single();

      if (error) throw error;
      return data as ReminderPreferences;
    },
    onSuccess: (data) => {
      const key = ["reminder-preferences", user?.id];
      queryClient.setQueryData(key, data);
      void cacheQueryData(key, data);
      void queryClient.invalidateQueries({ queryKey: ["reminder-preferences"] });
    }
  });
}

export function useSmartMealReminders() {
  const { user } = useAuth();
  const prefsQuery = useReminderPreferences();

  const historyQuery = useQuery({
    queryKey: ["smart-reminders-history", user?.id],
    queryFn: async () => {
      if (!user) return [] as Array<{ meal_type: MealType; created_at: string }>;
      const queryKey = ["smart-reminders-history", user.id];
      return runResilientQuery({
        queryKey,
        mode: "network-first",
        queryFn: async () => {
          const supabase = getSupabaseClient();
          const { data, error } = await supabase
            .from("meals")
            .select("meal_type, created_at")
            .eq("user_id", user.id)
            .gte("created_at", new Date(Date.now() - 1000 * 60 * 60 * 24 * 21).toISOString())
            .order("created_at", { ascending: false })
            .limit(400);

          if (error) throw error;
          return (data ?? []) as Array<{ meal_type: MealType; created_at: string }>;
        }
      });
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 10
  });

  const reminders = useMemo(() => {
    const prefs = prefsQuery.data;
    if (!prefs?.enabled) return [] as SmartReminder[];

    const timeByMeal = new Map<MealType, number[]>();
    for (const mealType of mealTypes) timeByMeal.set(mealType, []);

    for (const row of historyQuery.data ?? []) {
      const createdDate = new Date(row.created_at);
      const parts = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: prefs.timezone_name || "UTC"
      }).formatToParts(createdDate);
      const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
      const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);
      const minutes = hour * 60 + minute;
      timeByMeal.get(row.meal_type)?.push(minutes);
    }

    return mealTypes
      .filter((mealType) => {
        if (mealType === "breakfast") return prefs.breakfast_enabled;
        if (mealType === "lunch") return prefs.lunch_enabled;
        if (mealType === "dinner") return prefs.dinner_enabled;
        return prefs.snack_enabled;
      })
      .map((mealType) => {
        const samples = [...(timeByMeal.get(mealType) ?? [])].sort((a, b) => a - b);
        const defaultMinutes = toMinutes(defaultTimes[mealType]);
        const medianMinutes = samples.length ? samples[Math.floor(samples.length / 2)] : defaultMinutes;
        const safeTime = clampToQuietHours(
          fromMinutes(medianMinutes),
          prefs.quiet_hours_start.slice(0, 5),
          prefs.quiet_hours_end.slice(0, 5)
        );

        return {
          mealType,
          time: safeTime
        };
      });
  }, [historyQuery.data, prefsQuery.data]);

  return {
    reminders,
    isLoading: prefsQuery.isLoading || historyQuery.isLoading,
    preferences: prefsQuery.data,
    updatePreferences: useUpdateReminderPreferences()
  };
}
