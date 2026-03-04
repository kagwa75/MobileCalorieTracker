import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase";
import { formatDateKey, startOfDay, subDays } from "@/lib/date";
import type { MealItem, MealType } from "@/shared/schemas";

export type MealItemRecord = MealItem & {
  id: string;
  meal_id: string;
};

export type MealRecord = {
  id: string;
  user_id: string;
  meal_type: MealType;
  date: string;
  total_calories: number | null;
  total_protein: number | null;
  total_carbs: number | null;
  total_fat: number | null;
  photo_url: string | null;
  meal_items: MealItemRecord[];
};

export type MealRangeRecord = {
  id: string;
  date: string;
  total_calories: number | null;
};

export function useMealsByDate(date: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["meals", user?.id, date],
    queryFn: async () => {
      if (!user) return [] as MealRecord[];
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("meals")
        .select("*, meal_items(*)")
        .eq("user_id", user.id)
        .eq("date", date)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as MealRecord[];
    },
    enabled: !!user
  });
}

export function useMealsByRange(startDate: string, endDate: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["meals-range", user?.id, startDate, endDate],
    queryFn: async () => {
      if (!user) return [] as MealRangeRecord[];
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("meals")
        .select("id, date, total_calories")
        .eq("user_id", user.id)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true });

      if (error) throw error;
      return (data ?? []) as MealRangeRecord[];
    },
    enabled: !!user
  });
}

export function useMealStreak() {
  const { user } = useAuth();
  const today = startOfDay(new Date());
  const todayStr = formatDateKey(today);

  return useQuery({
    queryKey: ["meal-streak", user?.id, todayStr],
    queryFn: async () => {
      if (!user) return 0;
      const supabase = getSupabaseClient();

      const earliestDate = formatDateKey(subDays(today, 120));
      const { data, error } = await supabase
        .from("meals")
        .select("date")
        .eq("user_id", user.id)
        .gte("date", earliestDate)
        .order("date", { ascending: false });

      if (error) throw error;

      const loggedDays = new Set((data ?? []).map((meal) => meal.date));
      let streak = 0;
      let cursor = today;

      while (loggedDays.has(formatDateKey(cursor))) {
        streak += 1;
        cursor = subDays(cursor, 1);
      }

      return streak;
    },
    enabled: !!user
  });
}

export function useCreateMeal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      mealType,
      items,
      photoUrl,
      date
    }: {
      mealType: MealType;
      items: MealItem[];
      photoUrl?: string;
      date: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const supabase = getSupabaseClient();

      const totalCalories = items.reduce((sum, item) => sum + item.calories, 0);
      const totalProtein = items.reduce((sum, item) => sum + item.protein, 0);
      const totalCarbs = items.reduce((sum, item) => sum + item.carbs, 0);
      const totalFat = items.reduce((sum, item) => sum + item.fat, 0);

      const { data: meal, error: mealError } = await supabase
        .from("meals")
        .insert({
          user_id: user.id,
          meal_type: mealType,
          photo_url: photoUrl,
          total_calories: totalCalories,
          total_protein: totalProtein,
          total_carbs: totalCarbs,
          total_fat: totalFat,
          date
        })
        .select()
        .single();

      if (mealError) throw mealError;

      const mealItems = items.map((item) => ({
        meal_id: meal.id,
        food_name: item.food_name,
        quantity: item.quantity,
        serving_size: item.serving_size,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat
      }));

      const { error: itemsError } = await supabase.from("meal_items").insert(mealItems);
      if (itemsError) throw itemsError;

      return meal;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meals"] });
      void queryClient.invalidateQueries({ queryKey: ["meals-range"] });
      void queryClient.invalidateQueries({ queryKey: ["meal-streak"] });
    }
  });
}

export function useDeleteMeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mealId: string) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("meals").delete().eq("id", mealId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meals"] });
      void queryClient.invalidateQueries({ queryKey: ["meals-range"] });
      void queryClient.invalidateQueries({ queryKey: ["meal-streak"] });
    }
  });
}
