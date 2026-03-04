import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { formatDateKey, formatShortDate } from "@/lib/date";
import { useMealStreak, useMealsByDate } from "@/hooks/useMeals";
import { useProfile } from "@/hooks/useProfile";
import type { MealType } from "@/shared/schemas";
import { AppScreen } from "@/components/layout/AppScreen";
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

  const { data: meals = [], isLoading: mealsLoading } = useMealsByDate(todayKey);
  const { data: streak = 0, isLoading: streakLoading } = useMealStreak();
  const { data: profile, isLoading: profileLoading } = useProfile();

  const totalCalories = meals.reduce((sum, meal) => sum + (meal.total_calories || 0), 0);
  const totalProtein = meals.reduce((sum, meal) => sum + (meal.total_protein || 0), 0);
  const totalCarbs = meals.reduce((sum, meal) => sum + (meal.total_carbs || 0), 0);
  const totalFat = meals.reduce((sum, meal) => sum + (meal.total_fat || 0), 0);
  const dailyGoal = profile?.daily_calorie_goal ?? 2000;

  const progress = Math.min((totalCalories / Math.max(dailyGoal, 1)) * 100, 100);
  const remaining = Math.max(dailyGoal - totalCalories, 0);

  const loading = mealsLoading || profileLoading;

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
                <Text style={styles.heroMeta}>Remaining</Text>
                <Text style={styles.heroRemaining}>{remaining}</Text>
              </View>
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>

            <Text style={styles.heroMetaCentered}>
              {totalCalories} / {dailyGoal} kcal
            </Text>
          </AppCard>

          <View style={styles.rowCards}>
            <AppCard style={styles.rowCardLeft}>
              <Text style={styles.cardCaption}>Streak</Text>
              <Text style={styles.cardValue}>{streakLoading ? "..." : `${streak} day${streak === 1 ? "" : "s"}`}</Text>
              <Text style={styles.cardHint}>Keep logging to keep it alive.</Text>
            </AppCard>

            <AppCard style={styles.rowCardRight}>
              <Text style={styles.cardCaption}>Macros</Text>
              <Text style={styles.macroLine}>P {Math.round(totalProtein)}g</Text>
              <Text style={styles.macroLine}>C {Math.round(totalCarbs)}g</Text>
              <Text style={styles.macroLine}>F {Math.round(totalFat)}g</Text>
            </AppCard>
          </View>

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
