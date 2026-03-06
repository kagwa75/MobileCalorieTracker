import type { ActivityLevel, Gender, Goal, TargetPace } from "@/lib/calorieTarget";

export type AuthMode = "sign_in" | "sign_up";

export function validateAuthInput(input: { email: string; password: string; mode: AuthMode }) {
  const normalizedEmail = input.email.trim();
  if (!normalizedEmail || !input.password) {
    return "Enter both email and password.";
  }

  if (!normalizedEmail.includes("@") || !normalizedEmail.includes(".")) {
    return "Enter a valid email address.";
  }

  if (input.mode === "sign_up" && input.password.length < 6) {
    return "Password must be at least 6 characters.";
  }

  return null;
}

export function validateOnboardingInput(input: {
  age: number | null;
  weightKg: number | null;
  heightCm: number | null;
  gender: Gender;
  activityLevel: ActivityLevel;
  goal: Goal;
  targetPace: TargetPace;
}) {
  if (!input.age || input.age < 13 || input.age > 120) {
    return "Enter an age between 13 and 120.";
  }

  if (!input.weightKg || input.weightKg < 25 || input.weightKg > 400) {
    return "Enter a weight between 25 and 400 kg.";
  }

  if (!input.heightCm || input.heightCm < 90 || input.heightCm > 250) {
    return "Enter a height between 90 and 250 cm.";
  }

  if (!input.gender || !input.activityLevel || !input.goal || !input.targetPace) {
    return "Complete all required onboarding selections.";
  }

  return null;
}

export function validateProfileWriteInput(input: {
  calorieGoal: number;
  quietStart: string;
  quietEnd: string;
  targetWeightKg: number | null;
}) {
  if (!Number.isFinite(input.calorieGoal) || input.calorieGoal < 500 || input.calorieGoal > 10000) {
    return "Set a daily calorie goal between 500 and 10000.";
  }

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(input.quietStart) || !timeRegex.test(input.quietEnd)) {
    return "Quiet hours must use HH:MM 24-hour format.";
  }

  if (input.targetWeightKg !== null && (!Number.isFinite(input.targetWeightKg) || input.targetWeightKg < 25 || input.targetWeightKg > 400)) {
    return "Target weight must be between 25 and 400 kg.";
  }

  return null;
}
