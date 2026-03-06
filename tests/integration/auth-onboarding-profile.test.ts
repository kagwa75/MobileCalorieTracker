import test from "node:test";
import assert from "node:assert/strict";
import { validateAuthInput, validateOnboardingInput, validateProfileWriteInput } from "../../src/lib/flowValidation";

test("auth validation catches bad sign-up password", () => {
  const error = validateAuthInput({
    email: "user@example.com",
    password: "123",
    mode: "sign_up"
  });

  assert.equal(error, "Password must be at least 6 characters.");
});

test("auth validation accepts valid sign-in", () => {
  const error = validateAuthInput({
    email: "user@example.com",
    password: "good-pass-1",
    mode: "sign_in"
  });

  assert.equal(error, null);
});

test("onboarding validation catches out-of-range values", () => {
  const error = validateOnboardingInput({
    age: 11,
    weightKg: 10,
    heightCm: 70,
    gender: "female",
    activityLevel: "moderate",
    goal: "lose",
    targetPace: "medium"
  });

  assert.equal(error, "Enter an age between 13 and 120.");
});

test("onboarding validation accepts complete payload", () => {
  const error = validateOnboardingInput({
    age: 28,
    weightKg: 71.2,
    heightCm: 170,
    gender: "male",
    activityLevel: "active",
    goal: "gain",
    targetPace: "slow"
  });

  assert.equal(error, null);
});

test("profile write validation rejects invalid quiet-hours format", () => {
  const error = validateProfileWriteInput({
    calorieGoal: 2100,
    quietStart: "9pm",
    quietEnd: "06:00",
    targetWeightKg: 68
  });

  assert.equal(error, "Quiet hours must use HH:MM 24-hour format.");
});

test("profile write validation accepts valid payload", () => {
  const error = validateProfileWriteInput({
    calorieGoal: 2300,
    quietStart: "22:00",
    quietEnd: "06:30",
    targetWeightKg: 72
  });

  assert.equal(error, null);
});
