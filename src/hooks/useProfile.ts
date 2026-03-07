import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase";
import type { ActivityLevel, DietaryPreference, Gender, Goal, TargetPace } from "@/lib/calorieTarget";
import { cacheQueryData, runResilientQuery } from "@/lib/resilientQuery";

export type ProfileRecord = {
  id: string;
  user_id: string;
  display_name: string | null;
  age: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  gender: Gender | null;
  activity_level: ActivityLevel | null;
  goal: Goal | null;
  target_pace: TargetPace | null;
  dietary_preference: DietaryPreference | null;
  timezone_name: string | null;
  adaptive_calorie_target_enabled: boolean | null;
  baseline_calorie_goal: number | null;
  target_weight_kg: number | null;
  last_target_recalculated_on: string | null;
  daily_calorie_goal: number | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileUpdates = {
  display_name?: string;
  age?: number;
  weight_kg?: number;
  height_cm?: number;
  gender?: Gender;
  activity_level?: ActivityLevel;
  goal?: Goal;
  target_pace?: TargetPace;
  dietary_preference?: DietaryPreference;
  timezone_name?: string;
  adaptive_calorie_target_enabled?: boolean;
  baseline_calorie_goal?: number;
  target_weight_kg?: number;
  last_target_recalculated_on?: string;
  daily_calorie_goal?: number;
  onboarding_completed_at?: string;
};

export function isOnboardingComplete(profile: ProfileRecord | null | undefined) {
  if (!profile) return false;

  return Boolean(
    profile.age &&
      profile.weight_kg &&
      profile.height_cm &&
      profile.gender &&
      profile.activity_level &&
      profile.goal &&
      profile.target_pace &&
      profile.dietary_preference &&
      profile.daily_calorie_goal &&
      profile.onboarding_completed_at
  );
}

export function useProfile() {
  const { user } = useAuth();
  const queryKey = ["profile", user?.id] as const;

  return useQuery({
    queryKey,
    queryFn: async () => {
      if (!user) return null as ProfileRecord | null;
      return runResilientQuery({
        queryKey,
        mode: "cache-first",
        maxAgeMs: 1000 * 60 * 10,
        queryFn: async () => {
          const supabase = getSupabaseClient();
          const { data, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();

          if (error) throw error;
          return (data as ProfileRecord | null) ?? null;
        }
      });
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 10
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: ProfileUpdates) => {
      if (!user) throw new Error("Not authenticated");
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
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
      return data as ProfileRecord;
    },
    onSuccess: (data) => {
      const key = ["profile", user?.id];
      queryClient.setQueryData(key, data);
      void cacheQueryData(key, data);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  });
}

export type CalorieTargetRpcResult = {
  daily_calories: number;
  protein_grams: number;
  carbs_grams: number;
  fat_grams: number;
  expected_weekly_change_kg: number;
};

export function useCalorieTargetRpc() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      age: number;
      weightKg: number;
      heightCm: number;
      gender: Gender;
      activityLevel: ActivityLevel;
      goal: Goal;
      targetPace: TargetPace;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc("calculate_calorie_target", {
        p_age: input.age,
        p_weight_kg: input.weightKg,
        p_height_cm: input.heightCm,
        p_gender: input.gender,
        p_activity_level: input.activityLevel,
        p_goal: input.goal,
        p_target_pace: input.targetPace
      });

      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) throw new Error("No calorie target result from server");
      return row as CalorieTargetRpcResult;
    }
  });
}

export function useRecomputeProfileCalorieTarget() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc("recompute_profile_calorie_target", {
        p_user_id: user.id
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      return (row as CalorieTargetRpcResult | null) ?? null;
    },
    onSuccess: (data) => {
      const key = ["profile", user?.id];
      if (data) {
        const current = queryClient.getQueryData<ProfileRecord | null>(key);
        if (current) {
          const merged: ProfileRecord = {
            ...current,
            daily_calorie_goal: data.daily_calories
          };
          queryClient.setQueryData(key, merged);
          void cacheQueryData(key, merged);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  });
}
