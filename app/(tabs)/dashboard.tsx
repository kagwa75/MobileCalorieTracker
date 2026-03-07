import { useCallback, useEffect } from "react";
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
import { LoadFailureCard } from "@/components/ui/LoadFailureCard";
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
  dinner: "#6366f1",
  snack: "#f43f5e"
};

const mealBgColors: Record<MealType, string> = {
  breakfast: "#fff8ed",
  lunch: "#ecfdf5",
  dinner: "#eef2ff",
  snack: "#fff1f2"
};

export default function DashboardScreen() {
  const today = new Date();
  const todayKey = formatDateKey(today);
  const weeklyStartKey = formatDateKey(subDays(today, 6));

  const mealsQuery = useMealsByDate(todayKey);
  const weekMealsQuery = useMealsByRange(weeklyStartKey, todayKey);
  const streakQuery = useMealStreak();
  const completeDayStreakQuery = useCompleteDayStreak();
  const profileQuery = useProfile();
  const { reminders, isLoading: remindersLoading } = useSmartMealReminders();
  const adaptiveRecalculate = useAdaptiveCalorieRecalculation();
  const meals = mealsQuery.data ?? [];
  const weekMeals = weekMealsQuery.data ?? [];
  const streak = streakQuery.data ?? 0;
  const completeDayStreak = completeDayStreakQuery.data ?? 0;
  const profile = profileQuery.data;

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

  const loading = mealsQuery.isLoading || profileQuery.isLoading || weekMealsQuery.isLoading;
  const isRefreshing =
    mealsQuery.isRefetching ||
    weekMealsQuery.isRefetching ||
    profileQuery.isRefetching ||
    streakQuery.isRefetching ||
    completeDayStreakQuery.isRefetching;
  const hasBlockingError = Boolean((profileQuery.isError && !profile) || (mealsQuery.isError && meals.length === 0));
  const handleRefresh = useCallback(() => {
    void Promise.all([
      mealsQuery.refetch(),
      weekMealsQuery.refetch(),
      profileQuery.refetch(),
      streakQuery.refetch(),
      completeDayStreakQuery.refetch()
    ]);
  }, [completeDayStreakQuery, mealsQuery, profileQuery, streakQuery, weekMealsQuery]);

  useEffect(() => {
    if (!profile?.adaptive_calorie_target_enabled || adaptiveRecalculate.isPending) return;

    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const lastDate = profile.last_target_recalculated_on ? parseDateKey(profile.last_target_recalculated_on) : null;
    const lastMs = lastDate ? lastDate.getTime() : 0;
    const daysSinceLast = lastDate ? Math.floor((todayStart.getTime() - lastMs) / (1000 * 60 * 60 * 24)) : 999;

    if (daysSinceLast < 7) return;
    void adaptiveRecalculate.mutateAsync(undefined).catch(() => {});
  }, [adaptiveRecalculate, profile, todayKey]);

  const firstName = profile?.display_name?.split(" ")[0] || "there";
  const dayOfWeek = today.toLocaleDateString("en-US", { weekday: "long" });

  return (
    <AppScreen onRefresh={handleRefresh} refreshing={isRefreshing}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good {getTimeGreeting()},</Text>
          <Text style={styles.title}>{firstName} 👋</Text>
        </View>
        <View style={styles.dateChip}>
          <Text style={styles.dateChipDay}>{dayOfWeek.slice(0, 3)}</Text>
          <Text style={styles.dateChipDate}>{today.getDate()}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading your data…</Text>
        </View>
      ) : hasBlockingError ? (
        <LoadFailureCard
          title="Dashboard temporarily unavailable"
          message="We could not refresh your latest data. Pull down or tap retry to recover."
          onAction={handleRefresh}
        />
      ) : (
        <>
          {/* Hero Calorie Card */}
          <View style={styles.heroCard}>
            <View style={styles.heroCardInner}>
              <View style={styles.heroLeft}>
                <Text style={styles.heroLabel}>Calories today</Text>
                <Text style={styles.heroCalories}>{totalCalories.toLocaleString()}</Text>
                <Text style={styles.heroGoal}>of {dailyGoal.toLocaleString()} kcal</Text>
              </View>
              <View style={styles.heroRight}>
                <View style={[styles.heroBadge, isOverGoal ? styles.heroBadgeOver : styles.heroBadgeUnder]}>
                  <Text style={[styles.heroBadgeLabel, isOverGoal ? styles.heroBadgeLabelOver : styles.heroBadgeLabelUnder]}>
                    {summaryLabel}
                  </Text>
                  <Text style={[styles.heroBadgeValue, isOverGoal ? styles.heroBadgeValueOver : styles.heroBadgeValueUnder]}>
                    {summaryValue}
                  </Text>
                  <Text style={[styles.heroBadgeUnit, isOverGoal ? styles.heroBadgeLabelOver : styles.heroBadgeLabelUnder]}>
                    kcal
                  </Text>
                </View>
              </View>
            </View>

            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  isOverGoal ? styles.progressFillOver : null,
                  { width: `${progress}%` }
                ]}
              />
              {/* Goal marker */}
              {!isOverGoal && (
                <View style={[styles.progressMarker, { left: `${Math.min(progress + 2, 96)}%` as any }]}>
                  <Text style={styles.progressPct}>{Math.round(progress)}%</Text>
                </View>
              )}
            </View>
          </View>

          {/* Streak + Adherence row */}
          <View style={styles.statRow}>
            <AppCard style={styles.statCard}>
              <View style={styles.statIconWrap}>
                <MaterialCommunityIcons name="fire" size={20} color="#f97316" />
              </View>
              <Text style={styles.statValue}>
                {completeDayStreakQuery.isLoading ? "—" : completeDayStreak}
              </Text>
              <Text style={styles.statLabel}>Day streak</Text>
              {!streakQuery.isLoading && (
                <Text style={styles.statSub}>Any-log: {streak}d</Text>
              )}
            </AppCard>

            <AppCard style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: "#eef2ff" }]}>
                <MaterialCommunityIcons name="chart-line" size={20} color="#6366f1" />
              </View>
              <Text style={styles.statValue}>{weeklyAdherence.adherenceScore}%</Text>
              <Text style={styles.statLabel}>Weekly score</Text>
              <Text style={styles.statSub}>
                {weeklyAdherence.trackedDays
                  ? `${weeklyAdherence.averageDelta >= 0 ? "+" : ""}${weeklyAdherence.averageDelta} avg`
                  : "Log more days"}
              </Text>
            </AppCard>

            <AppCard style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: "#ecfdf5" }]}>
                <MaterialCommunityIcons name="target" size={20} color="#10b981" />
              </View>
              <Text style={styles.statValue}>{macroAdherence}%</Text>
              <Text style={styles.statLabel}>Macro fit</Text>
              <Text style={styles.statSub}>{weeklyAdherence.averageIntake} avg</Text>
            </AppCard>
          </View>

          <AdBanner />

          {/* Macro targets */}
          <AppCard style={styles.macroCard}>
            <View style={styles.macroCardHeader}>
              <Text style={styles.sectionTitle}>Macros</Text>
              <Text style={styles.macroCardSub}>Today's breakdown</Text>
            </View>

            <MacroBar
              label="Protein"
              color="#3b82f6"
              bg="#dbeafe"
              current={Math.round(totalProtein)}
              target={macroTargets.proteinGrams}
              pct={proteinProgress}
              unit="g"
            />
            <MacroBar
              label="Carbs"
              color="#10b981"
              bg="#d1fae5"
              current={Math.round(totalCarbs)}
              target={macroTargets.carbsGrams}
              pct={carbsProgress}
              unit="g"
            />
            <MacroBar
              label="Fat"
              color="#f59e0b"
              bg="#fef3c7"
              current={Math.round(totalFat)}
              target={macroTargets.fatGrams}
              pct={fatProgress}
              unit="g"
            />

            {proteinSuggestion ? (
              <View style={styles.suggestionRow}>
                <MaterialCommunityIcons name="lightbulb-outline" size={14} color={colors.primary} />
                <Text style={styles.suggestionText}>{proteinSuggestion}</Text>
              </View>
            ) : null}
          </AppCard>

          {/* Smart Reminders */}
          {!remindersLoading && reminders.length > 0 && (
            <AppCard style={styles.reminderCard}>
              <View style={styles.reminderHeader}>
                <MaterialCommunityIcons name="bell-ring-outline" size={16} color="#8b5cf6" />
                <Text style={styles.reminderTitle}>Upcoming reminders</Text>
              </View>
              <View style={styles.reminderList}>
                {reminders.map((reminder) => (
                  <View key={reminder.mealType} style={styles.reminderItem}>
                    <View style={styles.reminderDot} />
                    <Text style={styles.reminderText}>
                      <Text style={styles.reminderMealType}>
                        {reminder.mealType[0].toUpperCase()}{reminder.mealType.slice(1)}
                      </Text>
                      {"  "}{reminder.time}
                    </Text>
                  </View>
                ))}
              </View>
            </AppCard>
          )}

          {/* Today's Meals */}
          <View style={styles.mealsSectionHeader}>
            <Text style={styles.sectionTitle}>Today's meals</Text>
            <Text style={styles.mealsSectionSub}>
              {meals.length > 0 ? `${meals.length} logged` : "Tap to add"}
            </Text>
          </View>

          {mealTypes.map((mealType) => {
            const typeMeals = meals.filter((meal) => meal.meal_type === mealType);
            const allItems = typeMeals.flatMap((meal) => meal.meal_items || []);
            const calories = typeMeals.reduce((sum, meal) => sum + (meal.total_calories || 0), 0);
            const hasItems = allItems.length > 0;

            return (
              <Pressable
                key={mealType}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/add-meal",
                    params: { type: mealType }
                  })
                }
                style={({ pressed }) => [styles.mealCardWrap, pressed && styles.mealCardPressed]}
              >
                <AppCard style={styles.mealCard}>
                  {/* Left accent bar */}
                  <View style={[styles.mealAccent, { backgroundColor: mealColors[mealType] }]} />

                  <View style={styles.mealContent}>
                    <View style={styles.mealTopRow}>
                      <View style={styles.mealLeft}>
                        <View style={[styles.mealIconCircle, { backgroundColor: mealBgColors[mealType] }]}>
                          <MaterialCommunityIcons
                            name={mealIcons[mealType]}
                            color={mealColors[mealType]}
                            size={18}
                          />
                        </View>
                        <View>
                          <Text style={styles.mealTitle}>{mealLabels[mealType]}</Text>
                          <Text style={styles.mealSubtitle}>
                            {hasItems
                              ? `${allItems.length} item${allItems.length > 1 ? "s" : ""}`
                              : "Tap to log"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.mealRight}>
                        {hasItems ? (
                          <View>
                            <Text style={styles.mealCalories}>{calories}</Text>
                            <Text style={styles.mealUnit}>kcal</Text>
                          </View>
                        ) : (
                          <View style={styles.addPill}>
                            <MaterialCommunityIcons name="plus" size={14} color={mealColors[mealType]} />
                            <Text style={[styles.addPillText, { color: mealColors[mealType] }]}>Add</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {hasItems && (
                      <View style={styles.mealItems}>
                        {allItems.slice(0, 3).map((item, index) => (
                          <View key={`${mealType}-${index}`} style={styles.mealItemRow}>
                            <View style={[styles.mealItemDot, { backgroundColor: mealColors[mealType] }]} />
                            <Text style={styles.mealItemName} numberOfLines={1}>
                              {item.food_name}
                            </Text>
                            <Text style={styles.mealItemCal}>{item.calories} kcal</Text>
                          </View>
                        ))}
                        {allItems.length > 3 && (
                          <Text style={styles.mealMoreItems}>+{allItems.length - 3} more items</Text>
                        )}
                      </View>
                    )}
                  </View>
                </AppCard>
              </Pressable>
            );
          })}

          <View style={{ height: 100 }} />
        </>
      )}
    </AppScreen>
  );
}

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function MacroBar({
  label,
  color,
  bg,
  current,
  target,
  pct,
  unit
}: {
  label: string;
  color: string;
  bg: string;
  current: number;
  target: number;
  pct: number;
  unit: string;
}) {
  return (
    <View style={macroBarStyles.wrap}>
      <View style={macroBarStyles.labelRow}>
        <Text style={macroBarStyles.label}>{label}</Text>
        <Text style={macroBarStyles.values}>
          <Text style={[macroBarStyles.current, { color }]}>{current}{unit}</Text>
          <Text style={macroBarStyles.slash}> / </Text>
          <Text style={macroBarStyles.target}>{target}{unit}</Text>
        </Text>
      </View>
      <View style={[macroBarStyles.track, { backgroundColor: bg }]}>
        <View style={[macroBarStyles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const macroBarStyles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  label: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  values: {},
  current: { fontSize: 13, fontWeight: "800" },
  slash: { fontSize: 13, color: "#94a3b8" },
  target: { fontSize: 13, color: "#94a3b8", fontWeight: "600" },
  track: { height: 8, borderRadius: 99, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 99 }
});

const styles = StyleSheet.create({
  header: {
    marginTop: 8,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start"
  },
  greeting: {
    fontSize: 14,
    color: "#64748b",
    fontWeight: "500"
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: "#0f172a",
    marginTop: 1
  },
  dateChip: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: "center",
    minWidth: 52
  },
  dateChipDay: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  dateChipDate: {
    color: "white",
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 24
  },
  loadingWrap: {
    paddingVertical: 60,
    alignItems: "center",
    gap: 12
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 14
  },

  // Hero card
  heroCard: {
    backgroundColor: "#0f172a",
    borderRadius: 20,
    padding: 20,
    marginBottom: 12
  },
  heroCardInner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18
  },
  heroLeft: {},
  heroLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase"
  },
  heroCalories: {
    color: "white",
    fontSize: 42,
    fontWeight: "900",
    lineHeight: 48,
    marginTop: 2
  },
  heroGoal: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2
  },
  heroRight: {},
  heroBadge: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center"
  },
  heroBadgeUnder: { backgroundColor: "rgba(16,185,129,0.15)" },
  heroBadgeOver: { backgroundColor: "rgba(239,68,68,0.15)" },
  heroBadgeLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  heroBadgeLabelUnder: { color: "#34d399" },
  heroBadgeLabelOver: { color: "#f87171" },
  heroBadgeValue: { fontSize: 24, fontWeight: "900", lineHeight: 28 },
  heroBadgeValueUnder: { color: "#34d399" },
  heroBadgeValueOver: { color: "#f87171" },
  heroBadgeUnit: { fontSize: 11, fontWeight: "600" },
  progressTrack: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 99,
    overflow: "hidden",
    position: "relative"
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#34d399",
    borderRadius: 99
  },
  progressFillOver: {
    backgroundColor: "#f87171"
  },
  progressMarker: {
    position: "absolute",
    top: -18,
    transform: [{ translateX: -16 }]
  },
  progressPct: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "700"
  },

  // Stats row
  statRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12
  },
  statCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#fff4ed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8
  },
  statValue: {
    fontSize: 22,
    fontWeight: "900",
    color: "#0f172a"
  },
  statLabel: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: "600",
    marginTop: 1
  },
  statSub: {
    fontSize: 10,
    color: "#94a3b8",
    marginTop: 2,
    fontWeight: "500"
  },

  // Macro card
  macroCard: { marginBottom: 12 },
  macroCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14
  },
  macroCardSub: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "500"
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9"
  },
  suggestionText: {
    flex: 1,
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
    lineHeight: 17
  },

  // Reminders
  reminderCard: { marginBottom: 12, backgroundColor: "#faf5ff" },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10
  },
  reminderTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6d28d9"
  },
  reminderList: { gap: 6 },
  reminderItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  reminderDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: "#8b5cf6"
  },
  reminderText: { fontSize: 13, color: "#4c1d95", fontWeight: "500" },
  reminderMealType: { fontWeight: "700" },

  // Section header
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a"
  },
  mealsSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  },
  mealsSectionSub: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "600"
  },

  // Meal cards
  mealCardWrap: { marginBottom: 10 },
  mealCardPressed: { opacity: 0.92 },
  mealCard: {
    padding: 0,
    overflow: "hidden",
    flexDirection: "row"
  },
  mealAccent: {
    width: 4,
    borderRadius: 0
  },
  mealContent: {
    flex: 1,
    padding: 14
  },
  mealTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  mealLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  mealIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center"
  },
  mealTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a"
  },
  mealSubtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 1,
    fontWeight: "500"
  },
  mealRight: { alignItems: "flex-end" },
  mealCalories: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "right"
  },
  mealUnit: {
    fontSize: 11,
    color: "#94a3b8",
    textAlign: "right",
    fontWeight: "500"
  },
  addPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  addPillText: { fontSize: 12, fontWeight: "700" },
  mealItems: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    gap: 5
  },
  mealItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  mealItemDot: {
    width: 5,
    height: 5,
    borderRadius: 99,
    opacity: 0.6
  },
  mealItemName: {
    flex: 1,
    fontSize: 12,
    color: "#64748b",
    fontWeight: "500"
  },
  mealItemCal: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "600"
  },
  mealMoreItems: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
    marginLeft: 12,
    fontWeight: "500"
  }
});
