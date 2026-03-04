import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase";

export type ProfileRecord = {
  id: string;
  user_id: string;
  display_name: string | null;
  daily_calorie_goal: number | null;
  created_at: string;
  updated_at: string;
};

export function useProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null as ProfileRecord | null;
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error) throw error;
      return data as ProfileRecord;
    },
    enabled: !!user
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: { display_name?: string; daily_calorie_goal?: number }) => {
      if (!user) throw new Error("Not authenticated");
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) throw error;
      return data as ProfileRecord;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  });
}
