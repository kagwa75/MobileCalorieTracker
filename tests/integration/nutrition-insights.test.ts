import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProteinSuggestion,
  calculateCompleteDayStreakFromMeals,
  calculateGoalEta,
  calculateWeeklyAdherence,
  clampToQuietHours
} from "../../src/lib/nutritionInsights";

test("weekly adherence score decreases when average delta is high", () => {
  const metrics = calculateWeeklyAdherence(
    [
      { date: "2026-03-01", calories: 2600 },
      { date: "2026-03-02", calories: 2500 },
      { date: "2026-03-03", calories: 2700 }
    ],
    2000
  );

  assert.ok(metrics.adherenceScore < 90);
});

test("complete-day streak counts only days with breakfast/lunch/dinner", () => {
  const streak = calculateCompleteDayStreakFromMeals([
    { date: "2026-03-06", meal_type: "breakfast" },
    { date: "2026-03-06", meal_type: "lunch" },
    { date: "2026-03-06", meal_type: "dinner" },
    { date: "2026-03-05", meal_type: "breakfast" },
    { date: "2026-03-05", meal_type: "lunch" },
    { date: "2026-03-05", meal_type: "dinner" },
    { date: "2026-03-04", meal_type: "breakfast" }
  ]);

  assert.equal(streak, 2);
});

test("goal ETA responds with trend mismatch", () => {
  const eta = calculateGoalEta(80, 75, 0.4);
  assert.equal(eta, "Trend moving away");
});

test("quiet-hour clamping shifts reminders outside quiet time", () => {
  const shifted = clampToQuietHours("23:10", "22:00", "06:00");
  assert.equal(shifted, "06:30");
});

test("protein suggestion gives actionable gap", () => {
  const suggestion = buildProteinSuggestion({
    totalProtein: 90,
    proteinTarget: 130,
    remainingCalories: 600
  });

  assert.match(suggestion, /\+40g protein/);
});
