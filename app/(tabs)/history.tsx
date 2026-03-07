import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { getExpectedWeeklyWeightChange } from "@/lib/calorieTarget";
import {
  addDays,
  eachDayOfInterval,
  formatDateKey,
  formatLongDate,
  formatShortDate,
  parseDateKey,
  subDays
} from "@/lib/date";
import { calculateGoalEta, calculateMovingAverage } from "@/lib/nutritionInsights";
import { useDeleteMeal, useMealsByDate, useMealsByRange } from "@/hooks/useMeals";
import { useProfile } from "@/hooks/useProfile";
import { useWeightCheckins } from "@/hooks/useWeights";
import { captureClientError } from "@/lib/monitoring";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppCard } from "@/components/ui/AppCard";
import { AdBanner } from "@/components/ads/AdBanner";
import { LoadFailureCard } from "@/components/ui/LoadFailureCard";
import { colors, radius } from "@/theme/tokens";

const mealTypeColors: Record<string, string> = {
  breakfast: "#f59e0b",
  lunch: "#10b981",
  dinner: "#6366f1",
  snack: "#f43f5e"
};

export default function HistoryScreen() {
  const today = new Date();
  const todayKey = formatDateKey(today);

  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const selectedDate = parseDateKey(selectedDateKey);
  const profileQuery = useProfile();
  const profile = profileQuery.data;

  const mealsQuery = useMealsByDate(selectedDateKey);
  const meals = mealsQuery.data ?? [];

  const trendStart = subDays(selectedDate, 13);
  const trendStartKey = formatDateKey(trendStart);
  const rangeMealsQuery = useMealsByRange(trendStartKey, selectedDateKey);
  const rangeMeals = rangeMealsQuery.data ?? [];
  const weightTrendStart = subDays(selectedDate, 29);
  const weightTrendStartKey = formatDateKey(weightTrendStart);
  const weightQuery = useWeightCheckins(weightTrendStartKey, selectedDateKey);
  const weightCheckins = weightQuery.data ?? [];

  const deleteMeal = useDeleteMeal();
  const isRefreshing =
    mealsQuery.isRefetching || rangeMealsQuery.isRefetching || weightQuery.isRefetching || profileQuery.isRefetching;
  const hasBlockingError = Boolean(
    (mealsQuery.isError && meals.length === 0) || (rangeMealsQuery.isError && rangeMeals.length === 0)
  );
  const handleRefresh = useCallback(() => {
    void Promise.all([mealsQuery.refetch(), rangeMealsQuery.refetch(), weightQuery.refetch(), profileQuery.refetch()]);
  }, [mealsQuery, profileQuery, rangeMealsQuery, weightQuery]);

  const totals = useMemo(() => ({
    calories: meals.reduce((sum, meal) => sum + (meal.total_calories || 0), 0),
    protein: meals.reduce((sum, meal) => sum + (meal.total_protein || 0), 0),
    carbs: meals.reduce((sum, meal) => sum + (meal.total_carbs || 0), 0),
    fat: meals.reduce((sum, meal) => sum + (meal.total_fat || 0), 0)
  }), [meals]);

  const dailyGoal = profile?.daily_calorie_goal ?? 2000;

  const trendData = useMemo(() => {
    const caloriesByDate = new Map<string, number>();
    for (const meal of rangeMeals) {
      caloriesByDate.set(meal.date, (caloriesByDate.get(meal.date) || 0) + (meal.total_calories || 0));
    }
    return eachDayOfInterval(trendStart, selectedDate).map((day) => {
      const dateKey = formatDateKey(day);
      return {
        date: dateKey,
        label: formatShortDate(day),
        calories: caloriesByDate.get(dateKey) || 0,
        isToday: dateKey === todayKey
      };
    });
  }, [rangeMeals, trendStart, selectedDate, todayKey]);

  const maxTrendCalories = Math.max(...trendData.map((e) => e.calories), dailyGoal, 1);

  const weightTrendData = useMemo(
    () => calculateMovingAverage(weightCheckins.map((e) => ({ date: e.date, weightKg: e.weight_kg })), 7),
    [weightCheckins]
  );

  const latestWeight = weightTrendData[weightTrendData.length - 1]?.value ?? profile?.weight_kg ?? null;
  const expectedWeeklyChange =
    profile?.goal && profile?.target_pace ? getExpectedWeeklyWeightChange(profile.goal, profile.target_pace) : 0;
  const goalEta =
    latestWeight && profile?.target_weight_kg
      ? calculateGoalEta(latestWeight, profile.target_weight_kg, expectedWeeklyChange)
      : null;

  const minWeight = Math.min(...weightTrendData.map((e) => e.value));
  const maxWeight = Math.max(...weightTrendData.map((e) => e.value));

  const handleDeleteMeal = (mealId: string) => {
    Alert.alert("Delete meal", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try { await deleteMeal.mutateAsync(mealId); }
          catch (error) {
            void captureClientError(error, { screen: "history", action: "delete-meal" });
            Alert.alert("Delete failed", "Could not delete this meal.");
          }
        }
      }
    ]);
  };

  const canGoNextDay = selectedDateKey < todayKey;
  const calorieProgress = Math.min((totals.calories / Math.max(dailyGoal, 1)) * 100, 100);
  const isOverGoal = totals.calories > dailyGoal;

  return (
    <AppScreen onRefresh={handleRefresh} refreshing={isRefreshing}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <View style={styles.headerPill}>
          <MaterialCommunityIcons name="calendar-month-outline" size={14} color={colors.primary} />
          <Text style={styles.headerPillText}>14-day view</Text>
        </View>
      </View>

      {/* Date navigation */}
      <AppCard style={styles.navCard}>
        <View style={styles.dayNavRow}>
          <Pressable
            onPress={() => setSelectedDateKey(formatDateKey(addDays(selectedDate, -1)))}
            style={styles.navBtn}
          >
            <MaterialCommunityIcons name="chevron-left" size={20} color={colors.primary} />
          </Pressable>

          <View style={styles.dateLabelWrap}>
            <Text style={styles.dateLabel}>{formatLongDate(selectedDate)}</Text>
            {selectedDateKey === todayKey && (
              <View style={styles.todayBadge}>
                <Text style={styles.todayBadgeText}>Today</Text>
              </View>
            )}
          </View>

          <Pressable
            disabled={!canGoNextDay}
            onPress={() => setSelectedDateKey(formatDateKey(addDays(selectedDate, 1)))}
            style={[styles.navBtn, !canGoNextDay && styles.navBtnDisabled]}
          >
            <MaterialCommunityIcons name="chevron-right" size={20} color={canGoNextDay ? colors.primary : "#cbd5e1"} />
          </Pressable>
        </View>

        {/* Date chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }}>
          {trendData.map((entry) => {
            const isSelected = entry.date === selectedDateKey;
            const hasData = entry.calories > 0;
            return (
              <Pressable
                key={entry.date}
                onPress={() => setSelectedDateKey(entry.date)}
                style={[styles.dateChip, isSelected && styles.dateChipActive]}
              >
                <Text style={[styles.dateChipDay, isSelected && styles.dateChipDayActive]}>
                  {entry.label.split(" ")[0].slice(0, 3)}
                </Text>
                <Text style={[styles.dateChipNum, isSelected && styles.dateChipNumActive]}>
                  {entry.label.split(" ")[1]}
                </Text>
                <View style={[styles.dateChipDot, hasData ? styles.dateChipDotFilled : styles.dateChipDotEmpty, isSelected && styles.dateChipDotActive]} />
              </Pressable>
            );
          })}
        </ScrollView>
      </AppCard>

      {hasBlockingError && (
        <LoadFailureCard
          title="History data unavailable"
          message="We couldn't load your latest history right now. Pull to refresh or retry."
          onAction={handleRefresh}
        />
      )}

      {/* Daily totals */}
      <AppCard style={styles.totalsCard}>
        <View style={styles.totalsHeader}>
          <Text style={styles.sectionHeading}>
            {mealsQuery.isLoading ? "Loading…" : meals.length > 0 ? "Day summary" : "Nothing logged"}
          </Text>
          {!mealsQuery.isLoading && totals.calories > 0 && (
            <View style={[styles.goalStatusBadge, isOverGoal ? styles.goalOver : styles.goalUnder]}>
              <Text style={[styles.goalStatusText, isOverGoal ? styles.goalOverText : styles.goalUnderText]}>
                {isOverGoal ? `+${totals.calories - dailyGoal} over` : `${dailyGoal - totals.calories} left`}
              </Text>
            </View>
          )}
        </View>

        {!mealsQuery.isLoading && (
          <>
            <View style={styles.totalsRow}>
              <TotalCell label="Calories" value={totals.calories.toLocaleString()} unit="kcal" highlight />
              <TotalCell label="Protein" value={`${Math.round(totals.protein)}`} unit="g" />
              <TotalCell label="Carbs" value={`${Math.round(totals.carbs)}`} unit="g" />
              <TotalCell label="Fat" value={`${Math.round(totals.fat)}`} unit="g" isLast />
            </View>

            {totals.calories > 0 && (
              <View style={styles.dayProgressWrap}>
                <View style={styles.dayProgressTrack}>
                  <View
                    style={[
                      styles.dayProgressFill,
                      { width: `${calorieProgress}%` },
                      isOverGoal && styles.dayProgressOver
                    ]}
                  />
                  {/* Goal line */}
                  <View style={styles.dayProgressGoalLine} />
                </View>
                <View style={styles.dayProgressLabels}>
                  <Text style={styles.dayProgressLabel}>0</Text>
                  <Text style={styles.dayProgressLabel}>Goal: {dailyGoal}</Text>
                </View>
              </View>
            )}
          </>
        )}
      </AppCard>

      {/* 14-day chart */}
      <AppCard style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <Text style={styles.sectionHeading}>Calorie trend</Text>
          <Text style={styles.chartSubtitle}>14 days</Text>
        </View>

        {rangeMealsQuery.isLoading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View>
            {/* Goal reference line label */}
            <View style={styles.chartArea}>
              {/* Goal dashed line */}
              <View style={[styles.goalLine, { bottom: (dailyGoal / maxTrendCalories) * 120 + 20 }]}>
                <View style={styles.goalLineDash} />
                <Text style={styles.goalLineLabel}>Goal</Text>
              </View>

              <View style={styles.barsRow}>
                {trendData.map((entry) => {
                  const barHeight = Math.max((entry.calories / maxTrendCalories) * 120, entry.calories ? 5 : 2);
                  const isSelected = entry.date === selectedDateKey;
                  const overGoal = entry.calories > dailyGoal;
                  return (
                    <Pressable
                      key={entry.date}
                      onPress={() => setSelectedDateKey(entry.date)}
                      style={styles.barColumn}
                    >
                      <View
                        style={[
                          styles.bar,
                          { height: barHeight },
                          isSelected && styles.barSelected,
                          overGoal && !isSelected && styles.barOver
                        ]}
                      />
                      <Text style={[styles.barLabel, isSelected && styles.barLabelSelected]}>
                        {entry.label.split(" ")[1]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </AppCard>

      {/* Weight trend */}
      <AppCard style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <Text style={styles.sectionHeading}>Weight trend</Text>
          <Text style={styles.chartSubtitle}>7-day avg</Text>
        </View>

        {latestWeight && (
          <View style={styles.weightMetaRow}>
            <View style={styles.weightMetaBadge}>
              <Text style={styles.weightMetaValue}>{latestWeight.toFixed(1)}</Text>
              <Text style={styles.weightMetaUnit}>kg now</Text>
            </View>
            {profile?.target_weight_kg && (
              <View style={[styles.weightMetaBadge, { backgroundColor: "#ecfdf5" }]}>
                <Text style={[styles.weightMetaValue, { color: "#10b981" }]}>{profile.target_weight_kg}</Text>
                <Text style={[styles.weightMetaUnit, { color: "#059669" }]}>kg target</Text>
              </View>
            )}
            {goalEta && (
              <View style={[styles.weightMetaBadge, { backgroundColor: "#eef2ff" }]}>
                <Text style={[styles.weightMetaValue, { color: "#6366f1", fontSize: 13 }]}>{goalEta}</Text>
                <Text style={[styles.weightMetaUnit, { color: "#6366f1" }]}>ETA</Text>
              </View>
            )}
          </View>
        )}

        {weightQuery.isLoading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : weightTrendData.length ? (
          <View style={styles.barsRow}>
            {weightTrendData.slice(-14).map((entry) => {
              const spread = Math.max(maxWeight - minWeight, 0.1);
              const normalized = (entry.value - minWeight) / spread;
              const barHeight = 20 + normalized * 80;
              return (
                <View key={entry.date} style={styles.barColumn}>
                  <View style={[styles.bar, { height: barHeight, backgroundColor: "#a5b4fc" }]} />
                  <Text style={styles.barLabel}>{entry.date.slice(8)}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="scale-bathroom" size={28} color="#cbd5e1" />
            <Text style={styles.emptyText}>Log your weight in Profile to see trends</Text>
          </View>
        )}
      </AppCard>

      {/* Meal log */}
      <Text style={styles.mealLogTitle}>
        {mealsQuery.isLoading ? "Loading meals…" : meals.length > 0 ? `Meals · ${meals.length} logged` : "No meals logged"}
      </Text>

      {mealsQuery.isLoading ? (
        <View style={{ paddingVertical: 20, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : meals.length > 0 ? (
        meals.map((meal) => {
          const color = mealTypeColors[meal.meal_type] || colors.primary;
          return (
            <AppCard key={meal.id} style={styles.mealCard}>
              <View style={[styles.mealAccent, { backgroundColor: color }]} />
              <View style={styles.mealBody}>
                <View style={styles.mealHeader}>
                  <View style={styles.mealHeaderLeft}>
                    <View style={[styles.mealTypeDot, { backgroundColor: color }]} />
                    <Text style={styles.mealType}>{meal.meal_type}</Text>
                  </View>
                  <View style={styles.mealHeaderRight}>
                    <Text style={styles.mealCalories}>{meal.total_calories || 0}</Text>
                    <Text style={styles.mealCalUnit}>kcal</Text>
                    <Pressable onPress={() => handleDeleteMeal(meal.id)} style={styles.deleteBtn}>
                      <MaterialCommunityIcons name="trash-can-outline" size={15} color="#be123c" />
                    </Pressable>
                  </View>
                </View>

                {(meal.meal_items || []).length > 0 && (
                  <View style={styles.itemsList}>
                    {(meal.meal_items || []).map((item, index) => (
                      <View key={`${meal.id}-${index}`} style={styles.itemRow}>
                        <Text style={styles.itemName} numberOfLines={1}>{item.food_name}</Text>
                        <Text style={styles.itemCal}>{item.calories} kcal</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Macro pills */}
                {meal.total_protein || meal.total_carbs || meal.total_fat ? (
                  <View style={styles.macroPills}>
                    {meal.total_protein ? (
                      <View style={[styles.macroPill, { backgroundColor: "#dbeafe" }]}>
                        <Text style={[styles.macroPillText, { color: "#1d4ed8" }]}>P {Math.round(meal.total_protein)}g</Text>
                      </View>
                    ) : null}
                    {meal.total_carbs ? (
                      <View style={[styles.macroPill, { backgroundColor: "#d1fae5" }]}>
                        <Text style={[styles.macroPillText, { color: "#065f46" }]}>C {Math.round(meal.total_carbs)}g</Text>
                      </View>
                    ) : null}
                    {meal.total_fat ? (
                      <View style={[styles.macroPill, { backgroundColor: "#fef3c7" }]}>
                        <Text style={[styles.macroPillText, { color: "#92400e" }]}>F {Math.round(meal.total_fat)}g</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </AppCard>
          );
        })
      ) : (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="food-off-outline" size={36} color="#cbd5e1" />
          <Text style={styles.emptyText}>No meals logged for this day</Text>
        </View>
      )}

      <AdBanner />

      <View style={{ height: 100 }} />
    </AppScreen>
  );
}

function TotalCell({ label, value, unit, highlight = false, isLast = false }: { label: string; value: string; unit: string; highlight?: boolean; isLast?: boolean }) {
  return (
    <View style={[styles.totalCell, !isLast && styles.totalCellBorder]}>
      <Text style={[styles.totalValue, highlight && styles.totalValueHighlight]}>{value}</Text>
      <Text style={styles.totalUnit}>{unit}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 14
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f172a"
  },
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: `${colors.primary}15`,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99
  },
  headerPillText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 12
  },

  // Nav card
  navCard: { marginBottom: 12 },
  dayNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${colors.primary}12`,
    alignItems: "center",
    justifyContent: "center"
  },
  navBtnDisabled: { opacity: 0.4 },
  dateLabelWrap: { alignItems: "center", gap: 4 },
  dateLabel: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  todayBadge: {
    backgroundColor: colors.primary,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  todayBadgeText: { color: "white", fontSize: 10, fontWeight: "700" },
  dateChip: {
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    marginRight: 6,
    backgroundColor: "#f8fafc",
    minWidth: 42,
    gap: 2
  },
  dateChipActive: { backgroundColor: colors.primary },
  dateChipDay: { fontSize: 10, color: "#94a3b8", fontWeight: "700", textTransform: "uppercase" },
  dateChipDayActive: { color: "rgba(255,255,255,0.75)" },
  dateChipNum: { fontSize: 16, color: "#0f172a", fontWeight: "800" },
  dateChipNumActive: { color: "white" },
  dateChipDot: { width: 5, height: 5, borderRadius: 99, marginTop: 2 },
  dateChipDotFilled: { backgroundColor: "#10b981" },
  dateChipDotEmpty: { backgroundColor: "#e2e8f0" },
  dateChipDotActive: { backgroundColor: "rgba(255,255,255,0.6)" },

  // Totals card
  totalsCard: { marginBottom: 12 },
  totalsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionHeading: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  goalStatusBadge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  goalUnder: { backgroundColor: "#d1fae5" },
  goalOver: { backgroundColor: "#fee2e2" },
  goalStatusText: { fontSize: 12, fontWeight: "700" },
  goalUnderText: { color: "#065f46" },
  goalOverText: { color: "#b91c1c" },
  totalsRow: { flexDirection: "row", marginBottom: 14 },
  totalCell: {
    flex: 1,
    alignItems: "center",
    paddingRight: 8
  },
  totalCellBorder: {
    borderRightWidth: 1,
    borderRightColor: "#f1f5f9",
    marginRight: 8
  },
  totalValue: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  totalValueHighlight: { color: colors.primary },
  totalUnit: { fontSize: 11, color: "#64748b", fontWeight: "600" },
  totalLabel: { fontSize: 11, color: "#94a3b8", marginTop: 1 },
  dayProgressWrap: { marginTop: 4 },
  dayProgressTrack: {
    height: 8,
    backgroundColor: "#f1f5f9",
    borderRadius: 99,
    overflow: "hidden",
    position: "relative"
  },
  dayProgressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 99
  },
  dayProgressOver: { backgroundColor: "#f87171" },
  dayProgressGoalLine: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: "rgba(0,0,0,0.1)"
  },
  dayProgressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4
  },
  dayProgressLabel: { fontSize: 10, color: "#94a3b8", fontWeight: "500" },

  // Charts
  chartCard: { marginBottom: 12 },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  chartSubtitle: { fontSize: 12, color: "#94a3b8", fontWeight: "500" },
  chartLoading: { height: 120, alignItems: "center", justifyContent: "center" },
  chartArea: { position: "relative" },
  goalLine: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    zIndex: 1
  },
  goalLineDash: {
    flex: 1,
    height: 1,
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderStyle: "dashed"
  },
  goalLineLabel: { fontSize: 9, color: "#94a3b8", fontWeight: "700" },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 140,
    gap: 3,
    paddingTop: 20
  },
  barColumn: { flex: 1, alignItems: "center" },
  bar: {
    width: "100%",
    borderRadius: 4,
    backgroundColor: "#bfdbfe",
    maxWidth: 18
  },
  barSelected: { backgroundColor: colors.primary },
  barOver: { backgroundColor: "#fca5a5" },
  barLabel: { fontSize: 9, color: "#94a3b8", marginTop: 4, fontWeight: "500" },
  barLabelSelected: { color: colors.primary, fontWeight: "700" },

  // Weight meta
  weightMetaRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  weightMetaBadge: {
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center"
  },
  weightMetaValue: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  weightMetaUnit: { fontSize: 10, color: "#64748b", fontWeight: "600" },

  // Meal log
  mealLogTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 10
  },
  mealCard: {
    flexDirection: "row",
    marginBottom: 10,
    padding: 0,
    overflow: "hidden"
  },
  mealAccent: { width: 4 },
  mealBody: { flex: 1, padding: 12 },
  mealHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8
  },
  mealHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  mealTypeDot: { width: 8, height: 8, borderRadius: 99 },
  mealType: { fontSize: 14, fontWeight: "800", color: "#0f172a", textTransform: "capitalize" },
  mealHeaderRight: { flexDirection: "row", alignItems: "center", gap: 5 },
  mealCalories: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  mealCalUnit: { fontSize: 11, color: "#94a3b8", fontWeight: "500" },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 99,
    backgroundColor: "#fff1f2",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4
  },
  itemsList: {
    gap: 5,
    marginBottom: 8
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  itemName: { flex: 1, fontSize: 12, color: "#64748b", fontWeight: "500" },
  itemCal: { fontSize: 12, color: "#94a3b8" },
  macroPills: { flexDirection: "row", gap: 6, marginTop: 4 },
  macroPill: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  macroPillText: { fontSize: 11, fontWeight: "700" },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center"
  }
});
