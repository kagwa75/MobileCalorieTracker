import { Platform } from "react-native";

export const colors = {
  background: "#edf4ff",
  backgroundStrong: "#e2ecff",
  surface: "#ffffff",
  text: "#13243a",
  mutedText: "#5f6f86",
  primary: "#0f4c81",
  primaryDeep: "#0b3b64",
  primarySoft: "#d7e9ff",
  accent: "#0e9f9a",
  border: "#d5e2f2",
  danger: "#c2410c",
  dangerSoft: "#ffedd5",
  success: "#0f766e"
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999
};

export const shadow = Platform.select({
  ios: {
    shadowColor: "#0c1e35",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }
  },
  android: {
    elevation: 2
  },
  default: {}
});
