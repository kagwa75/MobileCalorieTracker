import { z } from "zod";

export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

export const mealItemSchema = z
  .object({
    food_name: z.string().trim().min(1).max(120),
    quantity: z.coerce.number().finite().min(0).max(100),
    serving_size: z.string().trim().min(1).max(120),
    calories: z.coerce.number().finite().min(0).max(5000),
    protein: z.coerce.number().finite().min(0).max(500),
    carbs: z.coerce.number().finite().min(0).max(1000),
    fat: z.coerce.number().finite().min(0).max(500)
  })
  .strict();

export const analyzeFoodRequestSchema = z
  .object({
    image: z.string().min(16),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    imageBytes: z.number().int().positive().max(2_000_000).optional(),
    userDescription: z.string().trim().min(1).max(300).optional()
  })
  .strict();

export const analyzeFoodResponseSchema = z
  .object({
    items: z.array(mealItemSchema).max(25)
  })
  .strict();

export type MealType = z.infer<typeof mealTypeSchema>;
export type MealItem = z.infer<typeof mealItemSchema>;
export type AnalyzeFoodRequest = z.infer<typeof analyzeFoodRequestSchema>;
export type AnalyzeFoodResponse = z.infer<typeof analyzeFoodResponseSchema>;
