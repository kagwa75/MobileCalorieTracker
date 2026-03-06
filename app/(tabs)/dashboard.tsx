import { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { formatDateKey, formatShortDate, parseDateKey, subDays } from "@/lib/date";
import { calculateDailyMacroTargets } from "@/lib/calorieTarget";
import { buildProteinSuggestion, calculateWeeklyAdherence } from "@/lib/nutritionInsights";
import { useCompleteDayStreak, useMealStreak, useMealsByDate, useMealsByRange } from "@/hooks/useMeals";
import { useProfile } from "@/hooks/useProfile";
import { useSmartMealReminders } from "@/hooks/useReminders";
import { useAdaptiveCalorieRecalculation } from "@/hooks/useWeights";
import type { MealType } from "@/shared/schemas";
import { AppScreen } from "@/components/layout/AppScreen";
import { AdBanner } from "@/components/ads/AdBanner";
import { AppCard } from "@/components/ui/AppCard";
import { colors, radius } from "@/theme/tokens";

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

const mealLabels: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack"
};

const mealIcons: Record<MealType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  breakfast: "coffee-outline",
  lunch: "white-balance-sunny",
  dinner: "moon-waning-crescent",
  snack: "cookie-outline"
};

const mealColors: Record<MealType, string> = {
  breakfast: "#f59e0b",
  lunch: "#10b981",
  dinner: "#3b82f6",
  snack: "#ef4444"
};

export default function DashboardScreen() {
  const today = new Date();
  const todayKey = formatDateKey(today);
  const weeklyStartKey = formatDateKey(subDays(today, 6));

  const { data: meals = [], isLoading: mealsLoading } = useMealsByDate(todayKey);
  const { data: weekMeals = [], isLoading: weekMealsLoading } = useMealsByRange(weeklyStartKey, todayKey);
  const { data: streak = 0, isLoading: streakLoading } = useMealStreak();
  const { data: completeDayStreak = 0, isLoading: completeDayStreakLoading } = useCompleteDayStreak();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { reminders, isLoading: remindersLoading } = useSmartMealReminders();
  const adaptiveRecalculate = useAdaptiveCalorieRecalculation();

  const totalCalories = meals.reduce((sum, meal) => sum + (meal.total_calories || 0), 0);
  const totalProtein = meals.reduce((sum, meal) => sum + (meal.total_protein || 0), 0);
  const totalCarbs = meals.reduce((sum, meal) => sum + (meal.total_carbs || 0), 0);
  const totalFat = meals.reduce((sum, meal) => sum + (meal.total_fat || 0), 0);
  const dailyGoal = profile?.daily_calorie_goal ?? 2000;
  const profileWeightKg = Number(profile?.weight_kg ?? NaN);
  const macroTargets = calculateDailyMacroTargets({
    dailyCalories: dailyGoal,
    goal: profile?.goal,
    weightKg: Number.isFinite(profileWeightKg) ? profileWeightKg : null,
    dietaryPreference: profile?.dietary_preference
  });

  const progress = Math.min((totalCalories / Math.max(dailyGoal, 1)) * 100, 100);
  const isOverGoal = totalCalories > dailyGoal;
  const remaining = Math.max(dailyGoal - totalCalories, 0);
  const overBy = Math.max(totalCalories - dailyGoal, 0);
  const summaryLabel = isOverGoal ? "Over by" : "Remaining";
  const summaryValue = isOverGoal ? overBy : remaining;
  const proteinProgress = Math.min((totalProtein / Math.max(macroTargets.proteinGrams, 1)) * 100, 100);
  const carbsProgress = Math.min((totalCarbs / Math.max(macroTargets.carbsGrams, 1)) * 100, 100);
  const fatProgress = Math.min((totalFat / Math.max(macroTargets.fatGrams, 1)) * 100, 100);
  const macroAdherence = Math.round((proteinProgress + carbsProgress + fatProgress) / 3);
  const weeklyAdherence = calculateWeeklyAdherence(
    weekMeals.map((meal) => ({
      date: meal.date,
      calories: meal.total_calories || 0
    })),
    dailyGoal
  );
  const proteinSuggestion = buildProteinSuggestion({
    totalProtein,
    proteinTarget: macroTargets.proteinGrams,
    remainingCalories: dailyGoal - totalCalories
  });

  const loading = mealsLoading || profileLoading || weekMealsLoading;

  useEffect(() => {
    if (!profile?.adaptive_calorie_target_enabled || adaptiveRecalculate.isPending) return;

    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const lastDate = profile.last_target_recalculated_on ? parseDateKey(profile.last_target_recalculated_on) : null;
    const lastMs = lastDate ? lastDate.getTime() : 0;
    const daysSinceLast = lastDate ? Math.floor((todayStart.getTime() - lastMs) / (1000 * 60 * 60 * 24)) : 999;

    if (daysSinceLast < 7) return;
    void adaptiveRecalculate.mutateAsync(undefined).catch(() => {});
  }, [adaptiveRecalculate, profile, today]);

  return (
    <AppScreen>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Hi, {profile?.display_name?.split(" ")[0] || "there"}</Text>
          <Text style={styles.subtitle}>{formatShortDate(today)}</Text>
        </View>
        <View style={styles.headerBadge}>
          <MaterialCommunityIcons name="fire" size={18} color={colors.primary} />
          <Text style={styles.headerBadgeText}>Focus</Text>
        </View>
      </View>
      <AdBanner />

      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          <AppCard style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View>
                <Text style={styles.heroMeta}>Calories consumed</Text>
                <Text style={styles.heroValue}>{totalCalories}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.heroMeta}>{summaryLabel}</Text>
                <Text style={[styles.heroRemaining, isOverGoal && styles.heroOver]}>{summaryValue}</Text>
              </View>
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, isOverGoal && styles.progressFillOver, { width: `${progress}%` }]} />
            </View>

            <Text style={styles.heroMetaCentered}>
              {totalCalories} / {dailyGoal} kcal
            </Text>
          </AppCard>

          <View style={styles.rowCards}>
            <AppCard style={styles.rowCardLeft}>
              <Text style={styles.cardCaption}>Complete day streak</Text>
              <Text style={styles.cardValue}>
                {completeDayStreakLoading ? "..." : `${completeDayStreak} day${completeDayStreak === 1 ? "" : "s"}`}
              </Text>
              <Text style={styles.cardHint}>
                {streakLoading ? "..." : `Any-log streak: ${streak} day${streak === 1 ? "" : "s"}.`}
              </Text>
            </AppCard>

            <AppCard style={styles.rowCardRight}>
              <Text style={styles.cardCaption}>Weekly adherence</Text>
              <Text style={styles.cardValue}>{weeklyAdherence.adherenceScore}%</Text>
              <Text style={styles.cardHint}>
                {weeklyAdherence.trackedDays
                  ? `Avg ${weeklyAdherence.averageDelta >= 0 ? "+" : ""}${weeklyAdherence.averageDelta} kcal/day vs target.`
                  : "Log meals on more days to unlock insights."}
              </Text>
            </AppCard>
          </View>

          <AppCard style={{ marginBottom: 12 }}>
            <Text style={styles.sectionMiniTitle}>Goal adherence insights</Text>
            <Text style={styles.cardHint}>Macro adherence: {macroAdherence}%</Text>
            <Text style={styles.cardHint}>
              Weekly avg intake: {weeklyAdherence.averageIntake} kcal ({weeklyAdherence.trackedDays} tracked day
              {weeklyAdherence.trackedDays === 1 ? "" : "s"})
            </Text>
            <Text style={[styles.cardHint, { marginTop: 6, color: colors.text, fontWeight: "700" }]}>{proteinSuggestion}</Text>
          </AppCard>

          <AppCard style={{ marginBottom: 12 }}>
            <Text style={styles.sectionMiniTitle}>Smart reminders</Text>
            {remindersLoading ? (
              <Text style={styles.cardHint}>Loading reminders...</Text>
            ) : reminders.length ? (
              reminders.map((reminder) => (
                <Text key={reminder.mealType} style={styles.cardHint}>
                  {reminder.mealType[0].toUpperCase()}
                  {reminder.mealType.slice(1)} reminder: {reminder.time}
                </Text>
              ))
            ) : (
              <Text style={styles.cardHint}>Enable meal reminders in Profile to build your habit loop.</Text>
            )}
          </AppCard>

          <AppCard style={styles.macroCard}>
            <Text style={styles.sectionMiniTitle}>Macro targets</Text>

            <View style={styles.macroRow}>
              <View style={styles.macroRowTop}>
                <Text style={styles.macroName}>Protein</Text>
                <Text style={styles.macroAmount}>
                  {Math.round(totalProtein)} / {macroTargets.proteinGrams}g
                </Text>
              </View>
              <View style={styles.macroTrack}>
                <View style={[styles.macroFill, styles.proteinFill, { width: `${proteinProgress}%` }]} />
              </View>
            </View>

            <View style={styles.macroRow}>
              <View style={styles.macroRowTop}>
                <Text style={styles.macroName}>Carbs</Text>
                <Text style={styles.macroAmount}>
                  {Math.round(totalCarbs)} / {macroTargets.carbsGrams}g
                </Text>
              </View>
              <View style={styles.macroTrack}>
                <View style={[styles.macroFill, styles.carbsFill, { width: `${carbsProgress}%` }]} />
              </View>
            </View>

            <View style={styles.macroRow}>
              <View style={styles.macroRowTop}>
                <Text style={styles.macroName}>Fat</Text>
                <Text style={styles.macroAmount}>
                  {Math.round(totalFat)} / {macroTargets.fatGrams}g
                </Text>
              </View>
              <View style={styles.macroTrack}>
                <View style={[styles.macroFill, styles.fatFill, { width: `${fatProgress}%` }]} />
              </View>
            </View>
          </AppCard>

          <Text style={styles.sectionTitle}>Today’s meals</Text>
          {mealTypes.map((mealType) => {
            const typeMeals = meals.filter((meal) => meal.meal_type === mealType);
            const allItems = typeMeals.flatMap((meal) => meal.meal_items || []);
            const calories = typeMeals.reduce((sum, meal) => sum + (meal.total_calories || 0), 0);

            return (
              <Pressable
                key={mealType}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/add-meal",
                    params: { type: mealType }
                  })
                }
              >
                <AppCard style={styles.mealCard}>
                  <View style={styles.mealTopRow}>
                    <View style={styles.mealTitleWrap}>
                      <View style={[styles.mealIconDot, { backgroundColor: mealColors[mealType] }]}>
                        <MaterialCommunityIcons name={mealIcons[mealType]} color="white" size={16} />
                      </View>
                      <View>
                        <Text style={styles.mealTitle}>{mealLabels[mealType]}</Text>
                        <Text style={styles.mealSubTitle}>
                          {allItems.length ? `${allItems.length} item${allItems.length > 1 ? "s" : ""}` : "Tap to add"}
                        </Text>
                      </View>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.mealCalories}>{calories}</Text>
                      <Text style={styles.mealSubTitle}>kcal</Text>
                    </View>
                  </View>

                  {allItems.length > 0 ? (
                    <View style={{ marginTop: 8 }}>
                      {allItems.slice(0, 3).map((item, index) => (
                        <View key={`${mealType}-${index}`} style={styles.itemRow}>
                          <Text style={styles.itemName} numberOfLines={1}>
                            {item.food_name}
                          </Text>
                          <Text style={styles.itemCalories}>{item.calories} kcal</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </AppCard>
              </Pressable>
            );
          })}

          <View style={{ height: 90 }} />
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: 8,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text
  },
  subtitle: {
    color: colors.mutedText,
    marginTop: 2
  },
  headerBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  headerBadgeText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 12
  },
  heroCard: {
    marginBottom: 10,
    backgroundColor: "#102f50"
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12
  },
  heroMeta: {
    color: "#b5cce6",
    fontSize: 12,
    fontWeight: "600"
  },
  heroValue: {
    color: "white",
    fontSize: 34,
    fontWeight: "800"
  },
  heroRemaining: {
    color: "#a7f3d0",
    fontSize: 24,
    fontWeight: "800"
  },
  heroOver: {
    color: "#fecaca"
  },
  progressTrack: {
    height: 10,
    backgroundColor: "#3d5a79",
    borderRadius: radius.pill,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#5eead4",
    borderRadius: radius.pill
  },
  progressFillOver: {
    backgroundColor: "#f87171"
  },
  heroMetaCentered: {
    marginTop: 8,
    color: "#c7d7ea",
    fontSize: 12,
    textAlign: "center"
  },
  rowCards: {
    flexDirection: "row",
    marginBottom: 12
  },
  rowCardLeft: {
    flex: 1,
    marginRight: 6
  },
  rowCardRight: {
    flex: 1,
    marginLeft: 6
  },
  cardCaption: {
    color: colors.mutedText,
    fontWeight: "700",
    fontSize: 12
  },
  cardValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    marginTop: 3
  },
  cardHint: {
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 4
  },
  macroLine: {
    color: colors.text,
    marginTop: 5,
    fontWeight: "700"
  },
  macroCard: {
    marginBottom: 12
  },
  sectionMiniTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8
  },
  macroRow: {
    marginTop: 8
  },
  macroRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6
  },
  macroName: {
    color: colors.text,
    fontWeight: "700"
  },
  macroAmount: {
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: "700"
  },
  macroTrack: {
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: "#e6eef8",
    overflow: "hidden"
  },
  macroFill: {
    height: "100%",
    borderRadius: radius.pill
  },
  proteinFill: {
    backgroundColor: "#3b82f6"
  },
  carbsFill: {
    backgroundColor: "#10b981"
  },
  fatFill: {
    backgroundColor: "#f59e0b"
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8
  },
  mealCard: {
    marginBottom: 10
  },
  mealTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  mealTitleWrap: {
    flexDirection: "row",
    alignItems: "center"
  },
  mealIconDot: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8
  },
  mealTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700"
  },
  mealSubTitle: {
    color: colors.mutedText,
    fontSize: 12
  },
  mealCalories: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800"
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4
  },
  itemName: {
    color: colors.mutedText,
    maxWidth: "70%"
  },
  itemCalories: {
    color: colors.text,
    fontWeight: "600"
  }
});
