# Calorie Tracker Mobile (Expo)

Standalone React Native + Expo app with bundled Supabase edge functions and migrations.

## Setup

1. Copy `.env.example` to `.env` and set Supabase values.
2. Install dependencies: `npm install`.
3. Run checks/start:
   - `npm run typecheck`
   - `npm run start`

## Supabase Backend (Bundled)

This repository now includes:
- `supabase/functions/analyze-food`
- `supabase/functions/log-client-error`
- `supabase/migrations/*`

To deploy backend changes:
1. `supabase db push`
2. `supabase functions deploy analyze-food`
3. `supabase functions deploy log-client-error`

## Notes

- Uses `expo-router` for navigation.
- Shared schemas are vendored in `src/shared`.
- The Add Meal flow handles app rate-limit and provider rate-limit responses.
