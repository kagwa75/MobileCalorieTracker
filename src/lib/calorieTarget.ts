export const genderValues = ["male", "female", "non_binary"] as const;
export type Gender = (typeof genderValues)[number];

export const activityLevelValues = ["sedentary", "light", "moderate", "active", "very_active"] as const;
export type ActivityLevel = (typeof activityLevelValues)[number];

export const goalValues = ["lose", "maintain", "gain"] as const;
export type Goal = (typeof goalValues)[number];

export const targetPaceValues = ["slow", "medium", "aggressive"] as const;
export type TargetPace = (typeof targetPaceValues)[number];

export const dietaryPreferenceValues = ["balanced", "high_protein", "low_carb", "vegetarian", "vegan"] as const;
export type DietaryPreference = (typeof dietaryPreferenceValues)[number];

export type CalorieTargetInput = {
  age: number;
  weightKg: number;
  heightCm: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  goal: Goal;
  targetPace?: TargetPace;
};

export type CalorieTargetStatus = "under" | "just_met" | "over";

const activityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
};

const goalAdjustmentsByPace: Record<Goal, Record<TargetPace, number>> = {
  lose: {
    slow: -250,
    medium: -500,
    aggressive: -750
  },
  maintain: {
    slow: 0,
    medium: 0,
    aggressive: 0
  },
  gain: {
    slow: 150,
    medium: 300,
    aggressive: 450
  }
};

const lowerCalorieBound = 1200;
const upperCalorieBound = 4500;
const minimumCarbsGrams = 80;
const minimumFatGrams = 40;

function getBaseGenderConstant(gender: Gender) {
  if (gender === "male") return 5;
  if (gender === "female") return -161;
  return -78;
}

export function calculateDailyCalorieTarget(input: CalorieTargetInput) {
  const bmr =
    10 * input.weightKg +
    6.25 * input.heightCm -
    5 * input.age +
    getBaseGenderConstant(input.gender);

  const tdee = bmr * activityMultipliers[input.activityLevel];
  const targetPace = input.targetPace ?? "medium";
  const adjusted = tdee + goalAdjustmentsByPace[input.goal][targetPace];
  const rounded = Math.round(adjusted);

  return Math.min(Math.max(rounded, lowerCalorieBound), upperCalorieBound);
}

export function getExpectedWeeklyWeightChange(goal: Goal, targetPace: TargetPace) {
  if (goal === "maintain") return 0;
  if (goal === "lose") {
    if (targetPace === "slow") return -0.25;
    if (targetPace === "aggressive") return -0.75;
    return -0.5;
  }
  if (targetPace === "slow") return 0.2;
  if (targetPace === "aggressive") return 0.5;
  return 0.35;
}

export function handleCalorieTarget(previousCalories: number, nextCalories: number, dailyGoal: number): CalorieTargetStatus {
  const safeGoal = Math.max(Math.round(dailyGoal), 1);
  const previous = Math.max(Math.round(previousCalories), 0);
  const next = Math.max(Math.round(nextCalories), 0);

  if (previous < safeGoal && next >= safeGoal) return "just_met";
  if (next > safeGoal) return "over";
  return "under";
}

export type MacroTargetInput = {
  dailyCalories: number;
  goal?: Goal | null;
  weightKg?: number | null;
  dietaryPreference?: DietaryPreference | null;
};

export type MacroTargets = {
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

const proteinPerKgByGoal: Record<Goal, number> = {
  lose: 2,
  maintain: 1.6,
  gain: 1.8
};

const fatPerKgByGoal: Record<Goal, number> = {
  lose: 0.8,
  maintain: 0.9,
  gain: 1
};

function normalizeGoal(goal?: Goal | null): Goal {
  if (!goal) return "maintain";
  return goal;
}

export function calculateDailyMacroTargets(input: MacroTargetInput): MacroTargets {
  const dailyCalories = Math.max(Math.round(input.dailyCalories), lowerCalorieBound);
  const goal = normalizeGoal(input.goal);
  const hasWeight = Number.isFinite(input.weightKg ?? NaN) && (input.weightKg ?? 0) > 0;

  let proteinCalories = hasWeight
    ? (input.weightKg as number) * proteinPerKgByGoal[goal] * 4
    : dailyCalories * 0.3;
  let fatCalories = hasWeight
    ? Math.max((input.weightKg as number) * fatPerKgByGoal[goal] * 9, minimumFatGrams * 9)
    : dailyCalories * 0.3;

  const minimumCarbCalories = minimumCarbsGrams * 4;
  let carbsCalories = dailyCalories - proteinCalories - fatCalories;

  const dietaryPreference = input.dietaryPreference ?? "balanced";
  if (dietaryPreference === "high_protein") {
    const proteinBoostCalories = Math.min(dailyCalories * 0.08, carbsCalories * 0.4);
    proteinCalories += proteinBoostCalories;
    carbsCalories -= proteinBoostCalories;
  } else if (dietaryPreference === "low_carb") {
    const carbShiftCalories = Math.min(carbsCalories * 0.18, dailyCalories * 0.12);
    carbsCalories -= carbShiftCalories;
    fatCalories += carbShiftCalories;
  } else if (dietaryPreference === "vegetarian" || dietaryPreference === "vegan") {
    const proteinBoostCalories = Math.min(dailyCalories * 0.04, carbsCalories * 0.2);
    proteinCalories += proteinBoostCalories;
    carbsCalories -= proteinBoostCalories;
  }

  if (carbsCalories < minimumCarbCalories) {
    let deficit = minimumCarbCalories - carbsCalories;

    const reducibleFatCalories = Math.max(fatCalories - minimumFatGrams * 9, 0);
    const reducedFat = Math.min(reducibleFatCalories, deficit);
    fatCalories -= reducedFat;
    deficit -= reducedFat;

    if (deficit > 0) {
      const reducibleProteinCalories = Math.max(proteinCalories - 80 * 4, 0);
      const reducedProtein = Math.min(reducibleProteinCalories, deficit);
      proteinCalories -= reducedProtein;
      deficit -= reducedProtein;
    }

    if (deficit > 0) {
      fatCalories = Math.max(fatCalories - deficit, 0);
    }

    carbsCalories = dailyCalories - proteinCalories - fatCalories;
  }

  return {
    proteinGrams: Math.max(Math.round(proteinCalories / 4), 80),
    carbsGrams: Math.max(Math.round(carbsCalories / 4), minimumCarbsGrams),
    fatGrams: Math.max(Math.round(fatCalories / 9), minimumFatGrams)
  };
}
