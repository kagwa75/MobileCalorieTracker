import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase";
import { runResilientQuery } from "@/lib/resilientQuery";

export type WeightCheckinRecord = {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number;
  source: "manual" | "import";
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type AdaptiveRecalculationResult = {
  previous_target: number;
  new_target: number;
  weekly_weight_change: number;
  expected_weekly_change: number;
  adjustment: number;
};

export function useWeightCheckins(startDate: string, endDate: string) {
  const { user } = useAuth();
  const queryKey = ["weight-checkins", user?.id, startDate, endDate] as const;

  return useQuery({
    queryKey,
    queryFn: async () => {
      if (!user) return [] as WeightCheckinRecord[];
      return runResilientQuery({
        queryKey,
        mode: "network-first",
        queryFn: async () => {
          const supabase = getSupabaseClient();
          const { data, error } = await supabase
            .from("weight_checkins")
            .select("*")
            .eq("user_id", user.id)
            .gte("date", startDate)
            .lte("date", endDate)
            .order("date", { ascending: true });

          if (error) throw error;
          return (data ?? []) as WeightCheckinRecord[];
        }
      });
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5
  });
}

export function useUpsertWeightCheckin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ date, weightKg, note }: { date: string; weightKg: number; note?: string | null }) => {
      if (!user) throw new Error("Not authenticated");

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("weight_checkins")
        .upsert(
          {
            user_id: user.id,
            date,
            weight_kg: Number(weightKg.toFixed(2)),
            note: note?.trim() || null,
            source: "manual"
          },
          { onConflict: "user_id,date" }
        )
        .select("*")
        .single();

      if (error) throw error;
      return data as WeightCheckinRecord;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["weight-checkins"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  });
}

export function useAdaptiveCalorieRecalculation() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (effectiveDate?: string) => {
      if (!user) throw new Error("Not authenticated");

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc("recalculate_adaptive_calorie_target", {
        p_user_id: user.id,
        p_effective_date: effectiveDate ?? undefined
      });

      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      return (row ?? null) as AdaptiveRecalculationResult | null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["weight-checkins"] });
    }
  });
}
