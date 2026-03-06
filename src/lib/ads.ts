import Constants from "expo-constants";
import { Platform } from "react-native";

export const ADMOB_ANDROID_APP_ID = "ca-app-pub-7756166084305700~2592338158";

// Temporary iOS test App ID while your account/unit is under review.
export const ADMOB_IOS_APP_ID = "ca-app-pub-3940256099942544~1458002511";

export const ADMOB_ANDROID_BANNER_UNIT_ID =
  process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID?.trim() || "ca-app-pub-7756166084305700/6340011477";

// Set EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID once your iOS unit is approved.
export const ADMOB_IOS_BANNER_UNIT_ID = process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID?.trim() || "";

export const ADMOB_ANDROID_INTERSTITIAL_UNIT_ID =
  process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID?.trim() || "ca-app-pub-7756166084305700/2848323174";

// Set EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID once your iOS interstitial is approved.
export const ADMOB_IOS_INTERSTITIAL_UNIT_ID = process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID?.trim() || "";

export function isAdRuntimeSupported() {
  // Expo Go does not support this native ad module.
  return Constants.appOwnership !== "expo";
}

export function getBannerUnitId(testBannerId: string) {
  if (__DEV__) return testBannerId;

  if (Platform.OS === "android") return ADMOB_ANDROID_BANNER_UNIT_ID;
  if (ADMOB_IOS_BANNER_UNIT_ID) return ADMOB_IOS_BANNER_UNIT_ID;

  // Safe fallback until iOS production unit is provided.
  return testBannerId;
}

export function getInterstitialUnitId(testInterstitialId: string) {
  if (__DEV__) return testInterstitialId;

  if (Platform.OS === "android") return ADMOB_ANDROID_INTERSTITIAL_UNIT_ID;
  if (ADMOB_IOS_INTERSTITIAL_UNIT_ID) return ADMOB_IOS_INTERSTITIAL_UNIT_ID;

  // No production unit configured yet.
  return "";
}
