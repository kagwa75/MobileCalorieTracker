import { useMemo, useState } from "react";
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
import { colors, radius } from "@/theme/tokens";

export default function HistoryScreen() {
  const today = new Date();
  const todayKey = formatDateKey(today);

  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const selectedDate = parseDateKey(selectedDateKey);
  const { data: profile } = useProfile();

  const { data: meals = [], isLoading } = useMealsByDate(selectedDateKey);

  const trendStart = subDays(selectedDate, 13);
  const trendStartKey = formatDateKey(trendStart);
  const { data: rangeMeals = [], isLoading: trendLoading } = useMealsByRange(trendStartKey, selectedDateKey);
  const weightTrendStart = subDays(selectedDate, 29);
  const weightTrendStartKey = formatDateKey(weightTrendStart);
  const { data: weightCheckins = [], isLoading: weightLoading } = useWeightCheckins(weightTrendStartKey, selectedDateKey);

  const deleteMeal = useDeleteMeal();

  const totals = useMemo(() => {
    return {
      calories: meals.reduce((sum, meal) => sum + (meal.total_calories || 0), 0),
      protein: meals.reduce((sum, meal) => sum + (meal.total_protein || 0), 0),
      carbs: meals.reduce((sum, meal) => sum + (meal.total_carbs || 0), 0),
      fat: meals.reduce((sum, meal) => sum + (meal.total_fat || 0), 0)
    };
  }, [meals]);

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
        calories: caloriesByDate.get(dateKey) || 0
      };
    });
  }, [rangeMeals, trendStart, selectedDate]);

  const maxTrendCalories = Math.max(...trendData.map((entry) => entry.calories), 1);
  const weightTrendData = useMemo(
    () =>
      calculateMovingAverage(
        weightCheckins.map((entry) => ({
          date: entry.date,
          weightKg: entry.weight_kg
        })),
        7
      ),
    [weightCheckins]
  );
  const latestWeight = weightTrendData[weightTrendData.length - 1]?.value ?? profile?.weight_kg ?? null;
  const expectedWeeklyChange =
    profile?.goal && profile?.target_pace ? getExpectedWeeklyWeightChange(profile.goal, profile.target_pace) : 0;
  const goalEta =
    latestWeight && profile?.target_weight_kg
      ? calculateGoalEta(latestWeight, profile.target_weight_kg, expectedWeeklyChange)
      : "Set goal weight in profile";
  const minWeight = Math.min(...weightTrendData.map((entry) => entry.value), latestWeight ?? 0);
  const maxWeight = Math.max(...weightTrendData.map((entry) => entry.value), latestWeight ?? 1);

  const handleDeleteMeal = (mealId: string) => {
    Alert.alert("Delete meal", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMeal.mutateAsync(mealId);
          } catch (error) {
            void captureClientError(error, { screen: "history", action: "delete-meal" });
            Alert.alert("Delete failed", "Could not delete this meal.");
          }
        }
      }
    ]);
  };

  const canGoNextDay = selectedDateKey < todayKey;

  return (
    <AppScreen>
      <Text style={styles.title}>History</Text>
      <AdBanner />

      <AppCard style={{ marginBottom: 10 }}>
        <View style={styles.dayNavRow}>
          <Pressable onPress={() => setSelectedDateKey(formatDateKey(addDays(selectedDate, -1)))} style={styles.dayNavBtn}>
            <MaterialCommunityIcons name="chevron-left" size={18} color={colors.primary} />
            <Text style={styles.dayNavText}>Prev</Text>
          </Pressable>

          <Text style={styles.dateText}>{formatLongDate(selectedDate)}</Text>

          <Pressable
            disabled={!canGoNextDay}
            onPress={() => setSelectedDateKey(formatDateKey(addDays(selectedDate, 1)))}
            style={[styles.dayNavBtn, { opacity: canGoNextDay ? 1 : 0.4 }]}
          >
            <Text style={styles.dayNavText}>Next</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ marginTop: 12 }}>
          {trendData.map((entry) => (
            <Pressable
              key={entry.date}
              onPress={() => setSelectedDateKey(entry.date)}
              style={[styles.dayChip, entry.date === selectedDateKey && styles.dayChipActive]}
            >
              <Text style={[styles.dayChipText, entry.date === selectedDateKey && styles.dayChipTextActive]}>{entry.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </AppCard>

      <AppCard style={{ marginBottom: 10 }}>
        <Text style={styles.sectionHeading}>Daily totals</Text>
        <View style={styles.totalsRow}>
          <SummaryCell label="kcal" value={totals.calories.toString()} />
          <SummaryCell label="Protein" value={`${Math.round(totals.protein)}g`} />
          <SummaryCell label="Carbs" value={`${Math.round(totals.carbs)}g`} />
          <SummaryCell label="Fat" value={`${Math.round(totals.fat)}g`} isLast />
        </View>
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={styles.sectionHeading}>14-day calorie trend</Text>
        <Text style={styles.rangeText}>
          {formatShortDate(trendStart)} - {formatShortDate(selectedDate)}
        </Text>

        {trendLoading ? (
          <View style={{ height: 160, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View style={styles.chartRow}>
            {trendData.map((entry) => {
              const barHeight = Math.max((entry.calories / maxTrendCalories) * 122, entry.calories ? 6 : 2);
              return (
                <View key={entry.date} style={styles.chartColumn}>
                  <View
                    style={[
                      styles.chartBar,
                      {
                        height: barHeight,
                        backgroundColor: entry.date === selectedDateKey ? colors.primary : "#8ab5e7"
                      }
                    ]}
                  />
                  <Text style={styles.chartLabel}>{entry.label.split(" ")[1]}</Text>
                </View>
              );
            })}
          </View>
        )}
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={styles.sectionHeading}>Weight trend (7-day avg)</Text>
        <Text style={styles.rangeText}>
          {latestWeight ? `Current avg: ${latestWeight.toFixed(1)} kg` : "Add weigh-ins to unlock trend."}
        </Text>
        <Text style={styles.rangeText}>
          Goal ETA: {goalEta}
          {profile?.target_weight_kg ? ` (target ${profile.target_weight_kg} kg)` : ""}
        </Text>

        {weightLoading ? (
          <View style={{ height: 120, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : weightTrendData.length ? (
          <View style={[styles.chartRow, { height: 120 }]}>
            {weightTrendData.slice(-14).map((entry) => {
              const spread = Math.max(maxWeight - minWeight, 0.1);
              const normalized = (entry.value - minWeight) / spread;
              const barHeight = 16 + normalized * 84;

              return (
                <View key={entry.date} style={styles.chartColumn}>
                  <View style={[styles.chartBar, { height: barHeight, backgroundColor: "#6366f1" }]} />
                  <Text style={styles.chartLabel}>{entry.date.slice(8)}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.rangeText}>No weigh-ins yet. Add your current weight in Profile.</Text>
        )}
      </AppCard>

      {isLoading ? (
        <View style={{ paddingVertical: 20, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : meals.length ? (
        <View>
          {meals.map((meal) => (
            <AppCard key={meal.id} style={{ marginBottom: 10 }}>
              <View style={styles.mealHeader}>
                <Text style={styles.mealTitle}>{meal.meal_type}</Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={styles.mealCalories}>{meal.total_calories || 0} kcal</Text>
                  <Pressable onPress={() => handleDeleteMeal(meal.id)} style={styles.deletePill}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </Pressable>
                </View>
              </View>

              {(meal.meal_items || []).map((item, index) => (
                <View key={`${meal.id}-item-${index}`} style={styles.itemRow}>
                  <Text style={styles.itemName}>{item.food_name}</Text>
                  <Text style={styles.itemCalories}>{item.calories} kcal</Text>
                </View>
              ))}
            </AppCard>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>No meals logged for this day.</Text>
      )}

      <View style={{ height: 90 }} />
    </AppScreen>
  );
}

function SummaryCell({ label, value, isLast = false }: { label: string; value: string; isLast?: boolean }) {
  return (
    <View style={{ flex: 1, marginRight: isLast ? 0 : 8 }}>
      <Text style={styles.totalValue}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
    marginTop: 8,
    marginBottom: 10
  },
  dayNavRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  dayNavBtn: {
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    flexDirection: "row",
    alignItems: "center"
  },
  dayNavText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 12
  },
  dateText: {
    color: colors.text,
    fontWeight: "700"
  },
  dayChip: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: "#f0f6ff",
    marginRight: 8
  },
  dayChipActive: {
    backgroundColor: colors.primary
  },
  dayChipText: {
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: "600"
  },
  dayChipTextActive: {
    color: "white"
  },
  sectionHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8
  },
  totalsRow: {
    flexDirection: "row"
  },
  totalValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center"
  },
  totalLabel: {
    color: colors.mutedText,
    fontSize: 12,
    textAlign: "center"
  },
  rangeText: {
    color: colors.mutedText,
    fontSize: 12,
    marginBottom: 10
  },
  chartRow: {
    height: 150,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between"
  },
  chartColumn: {
    width: 18,
    alignItems: "center"
  },
  chartBar: {
    width: 14,
    borderRadius: 6
  },
  chartLabel: {
    fontSize: 9,
    color: colors.mutedText,
    marginTop: 4
  },
  mealHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5
  },
  mealTitle: {
    color: colors.text,
    fontWeight: "800",
    textTransform: "capitalize"
  },
  mealCalories: {
    color: colors.text,
    fontWeight: "700",
    marginRight: 8
  },
  deletePill: {
    backgroundColor: "#fff1f2",
    borderWidth: 1,
    borderColor: "#fecdd3",
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  deleteText: {
    color: "#be123c",
    fontWeight: "700",
    fontSize: 12
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4
  },
  itemName: {
    color: colors.mutedText
  },
  itemCalories: {
    color: colors.mutedText
  },
  emptyText: {
    textAlign: "center",
    color: colors.mutedText,
    marginVertical: 24
  }
});
