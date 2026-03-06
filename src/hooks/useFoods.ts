import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MealItem, MealType } from "@/shared/schemas";
import { useAuth } from "@/providers/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase";

export type CustomFoodRecord = {
  id: string;
  user_id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RecentFoodRecord = {
  id: string;
  user_id: string;
  food_name: string;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: "meal" | "custom" | "template" | "barcode";
  use_count: number;
  last_used_at: string;
};

export type MealTemplateRecord = {
  id: string;
  user_id: string;
  name: string;
  meal_type: MealType | null;
  is_favorite: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  meal_template_items?: Array<{
    id: string;
    food_name: string;
    quantity: number;
    serving_size: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    client_item_index: number;
  }>;
};

export function useRecentFoods(limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["recent-foods", user?.id, limit],
    queryFn: async () => {
      if (!user) return [] as RecentFoodRecord[];
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("recent_foods")
        .select("*")
        .eq("user_id", user.id)
        .order("last_used_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as RecentFoodRecord[];
    },
    enabled: !!user
  });
}

export function useCustomFoods(search = "") {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["custom-foods", user?.id, search],
    queryFn: async () => {
      if (!user) return [] as CustomFoodRecord[];
      const supabase = getSupabaseClient();
      let query = supabase
        .from("custom_foods")
        .select("*")
        .eq("user_id", user.id)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(50);

      if (search.trim()) {
        query = query.ilike("name", `%${search.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as CustomFoodRecord[];
    },
    enabled: !!user
  });
}

export function useLookupFoodByBarcode() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (barcode: string) => {
      if (!user) throw new Error("Not authenticated");

      const normalized = barcode.trim();
      if (!normalized) throw new Error("Enter a barcode");

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("custom_foods")
        .select("*")
        .eq("user_id", user.id)
        .eq("barcode", normalized)
        .maybeSingle();

      if (error) throw error;
      return (data as CustomFoodRecord | null) ?? null;
    }
  });
}

export function useUpsertCustomFood() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      id?: string;
      name: string;
      brand?: string | null;
      barcode?: string | null;
      servingSize?: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }) => {
      if (!user) throw new Error("Not authenticated");

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("custom_foods")
        .upsert(
          {
            id: payload.id,
            user_id: user.id,
            name: payload.name.trim(),
            brand: payload.brand?.trim() || null,
            barcode: payload.barcode?.trim() || null,
            serving_size: payload.servingSize?.trim() || "1 serving",
            calories: Math.max(Math.round(payload.calories), 0),
            protein: Number(payload.protein.toFixed(2)),
            carbs: Number(payload.carbs.toFixed(2)),
            fat: Number(payload.fat.toFixed(2)),
            last_used_at: new Date().toISOString()
          },
          { onConflict: "id" }
        )
        .select("*")
        .single();

      if (error) throw error;
      return data as CustomFoodRecord;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["custom-foods"] });
      void queryClient.invalidateQueries({ queryKey: ["recent-foods"] });
    }
  });
}

export function useMealTemplates() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["meal-templates", user?.id],
    queryFn: async () => {
      if (!user) return [] as MealTemplateRecord[];
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("meal_templates")
        .select("*, meal_template_items(*)")
        .eq("user_id", user.id)
        .order("is_favorite", { ascending: false })
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as MealTemplateRecord[];
    },
    enabled: !!user
  });
}

export function useCreateMealTemplate() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { name: string; mealType?: MealType; items: MealItem[] }) => {
      if (!user) throw new Error("Not authenticated");
      if (!payload.items.length) throw new Error("Add at least one item to create a template");

      const supabase = getSupabaseClient();

      const { data: template, error: templateError } = await supabase
        .from("meal_templates")
        .insert({
          user_id: user.id,
          name: payload.name.trim(),
          meal_type: payload.mealType ?? null,
          last_used_at: new Date().toISOString()
        })
        .select("*")
        .single();

      if (templateError) throw templateError;

      const templateItems = payload.items.map((item, index) => ({
        template_id: template.id,
        client_item_index: index,
        food_name: item.food_name,
        quantity: item.quantity,
        serving_size: item.serving_size,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat
      }));

      const { error: itemsError } = await supabase.from("meal_template_items").upsert(templateItems, {
        onConflict: "template_id,client_item_index"
      });

      if (itemsError) throw itemsError;
      return template as MealTemplateRecord;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meal-templates"] });
    }
  });
}

export function useTouchMealTemplate() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      if (!user) throw new Error("Not authenticated");
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("meal_templates")
        .update({ last_used_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", templateId);

      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["meal-templates"] });
    }
  });
}
