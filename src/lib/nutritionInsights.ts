import { addDays, formatDateKey, subDays } from "@/lib/date";
import type { MealType } from "@/shared/schemas";

export type DailyCalorieSummary = {
  date: string;
  calories: number;
};

export type WeightCheckin = {
  date: string;
  weightKg: number;
};

export type MovingAveragePoint = {
  date: string;
  value: number;
};

export type WeeklyAdherenceMetrics = {
  adherenceScore: number;
  averageDelta: number;
  averageIntake: number;
  trackedDays: number;
};

const requiredMealTypesForCompleteDay: MealType[] = ["breakfast", "lunch", "dinner"];

export function buildDailyCalorieMap(entries: DailyCalorieSummary[]) {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(entry.date, (map.get(entry.date) ?? 0) + Math.max(Math.round(entry.calories), 0));
  }
  return map;
}

export function calculateWeeklyAdherence(entries: DailyCalorieSummary[], dailyGoal: number): WeeklyAdherenceMetrics {
  const goal = Math.max(Math.round(dailyGoal), 1);
  const last7Start = subDays(new Date(), 6);
  const dailyMap = buildDailyCalorieMap(entries);

  const dailyDeltas: number[] = [];
  const dailyIntake: number[] = [];

  for (let i = 0; i < 7; i += 1) {
    const dateKey = formatDateKey(addDays(last7Start, i));
    if (!dailyMap.has(dateKey)) continue;

    const calories = dailyMap.get(dateKey) ?? 0;
    dailyIntake.push(calories);
    dailyDeltas.push(calories - goal);
  }

  if (!dailyDeltas.length) {
    return {
      adherenceScore: 0,
      averageDelta: 0,
      averageIntake: 0,
      trackedDays: 0
    };
  }

  const averageDelta = Math.round(dailyDeltas.reduce((sum, value) => sum + value, 0) / dailyDeltas.length);
  const averageIntake = Math.round(dailyIntake.reduce((sum, value) => sum + value, 0) / dailyIntake.length);

  const score = Math.max(0, Math.min(100, Math.round(100 - (Math.abs(averageDelta) / goal) * 100)));

  return {
    adherenceScore: score,
    averageDelta,
    averageIntake,
    trackedDays: dailyDeltas.length
  };
}

export function calculateMovingAverage(points: WeightCheckin[], windowSize = 7): MovingAveragePoint[] {
  if (windowSize <= 1) {
    return points.map((point) => ({ date: point.date, value: point.weightKg }));
  }

  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const result: MovingAveragePoint[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const start = Math.max(0, index - windowSize + 1);
    const window = sorted.slice(start, index + 1);
    const avg = window.reduce((sum, point) => sum + point.weightKg, 0) / window.length;
    result.push({
      date: sorted[index].date,
      value: Number(avg.toFixed(2))
    });
  }

  return result;
}

export function calculateGoalEta(currentWeight: number, targetWeight: number, weeklyChangeKg: number) {
  const remaining = Number((targetWeight - currentWeight).toFixed(2));
  if (Math.abs(remaining) < 0.05) return "Reached";
  if (Math.abs(weeklyChangeKg) < 0.01) return "Insufficient trend data";

  const directionMatches = remaining * weeklyChangeKg > 0;
  if (!directionMatches) return "Trend moving away";

  const weeks = Math.ceil(Math.abs(remaining / weeklyChangeKg));
  if (!Number.isFinite(weeks) || weeks <= 0) return "Insufficient trend data";

  if (weeks <= 1) return "~1 week";
  if (weeks <= 52) return `~${weeks} weeks`;
  return `~${Math.ceil(weeks / 4)} months`;
}

export function buildProteinSuggestion(input: {
  totalProtein: number;
  proteinTarget: number;
  remainingCalories: number;
}) {
  const proteinGap = Math.max(Math.round(input.proteinTarget - input.totalProtein), 0);
  if (!proteinGap) return "Protein target met for today.";

  const caloriesNeeded = proteinGap * 4;
  if (input.remainingCalories > 0 && caloriesNeeded > input.remainingCalories) {
    return `Prioritize lean protein, aim for +${proteinGap}g with lower-fat options.`;
  }

  return `Add about +${proteinGap}g protein to stay on target.`;
}

export function calculateCompleteDayStreakFromMeals(records: Array<{ date: string; meal_type: MealType }>) {
  const byDay = new Map<string, Set<MealType>>();

  for (const record of records) {
    if (!byDay.has(record.date)) byDay.set(record.date, new Set());
    byDay.get(record.date)?.add(record.meal_type);
  }

  const today = new Date();
  let streak = 0;

  for (let dayOffset = 0; dayOffset < 180; dayOffset += 1) {
    const dateKey = formatDateKey(subDays(today, dayOffset));
    const loggedMeals = byDay.get(dateKey);
    if (!loggedMeals) break;

    const isComplete = requiredMealTypesForCompleteDay.every((mealType) => loggedMeals.has(mealType));
    if (!isComplete) break;

    streak += 1;
  }

  return streak;
}

export function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map((value) => Number.parseInt(value, 10));
  const safeHours = Number.isFinite(hours) ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  return safeHours * 60 + safeMinutes;
}

export function fromMinutes(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
  const mm = String(normalized % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function clampToQuietHours(
  candidateTime: string,
  quietStart: string,
  quietEnd: string
) {
  const candidate = toMinutes(candidateTime);
  const quietStartMins = toMinutes(quietStart);
  const quietEndMins = toMinutes(quietEnd);

  const quietCrossesMidnight = quietStartMins > quietEndMins;
  const inQuietHours = quietCrossesMidnight
    ? candidate >= quietStartMins || candidate < quietEndMins
    : candidate >= quietStartMins && candidate < quietEndMins;

  if (!inQuietHours) return candidateTime;

  return fromMinutes(quietEndMins + 30);
}
