import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, router } from "expo-router";
import { captureClientError } from "@/lib/monitoring";
import { formatDateKey } from "@/lib/date";
import { getSupabaseClient } from "@/lib/supabase";
import { useCreateMeal } from "@/hooks/useMeals";
import type { AnalyzeFoodResponse, MealItem, MealType } from "@/shared/schemas";
import { analyzeFoodResponseSchema } from "@/shared/schemas";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { colors, radius } from "@/theme/tokens";

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const mealLabels: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack"
};

const photoAnalysisEnabled = process.env.EXPO_PUBLIC_ENABLE_AI_PHOTO_ANALYSIS !== "false";
const MAX_IMAGE_BYTES = 2_000_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isMealType(value: string): value is MealType {
  return mealTypes.includes(value as MealType);
}

function parseNumber(input: string) {
  const value = Number.parseFloat(input);
  return Number.isFinite(value) ? value : 0;
}

export default function AddMealScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const createMeal = useCreateMeal();

  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [description, setDescription] = useState("");
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [items, setItems] = useState<MealItem[]>([]);

  const [manualName, setManualName] = useState("");
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");

  useEffect(() => {
    if (typeof type === "string" && isMealType(type)) {
      setMealType(type);
    }
  }, [type]);

  const totalCalories = useMemo(
    () => items.reduce((sum, item) => sum + (Number.isFinite(item.calories) ? item.calories : 0), 0),
    [items]
  );

  const addManualItem = () => {
    if (!manualName.trim()) {
      Alert.alert("Missing name", "Enter a food name before adding.");
      return;
    }

    setItems((previous) => [
      ...previous,
      {
        food_name: manualName.trim(),
        quantity: 1,
        serving_size: "1 serving",
        calories: parseNumber(manualCalories),
        protein: parseNumber(manualProtein),
        carbs: parseNumber(manualCarbs),
        fat: parseNumber(manualFat)
      }
    ]);

    setManualName("");
    setManualCalories("");
    setManualProtein("");
    setManualCarbs("");
    setManualFat("");
  };

  const updateItem = (index: number, patch: Partial<MealItem>) => {
    setItems((previous) => previous.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const analyzeAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!photoAnalysisEnabled) {
      Alert.alert("Photo analysis disabled", "Enable EXPO_PUBLIC_ENABLE_AI_PHOTO_ANALYSIS to use this feature.");
      return;
    }

    if (!asset.base64 || !asset.mimeType) {
      Alert.alert("Upload failed", "Could not read selected image.");
      return;
    }

    const normalizedMimeType = asset.mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : asset.mimeType.toLowerCase();
    const imageBytes = Math.floor((asset.base64.length * 3) / 4);

    if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
      Alert.alert(
        "Unsupported image format",
        "Use a JPEG/PNG/WEBP image. iOS HEIC photos may fail unless converted."
      );
      return;
    }

    if (imageBytes > MAX_IMAGE_BYTES) {
      Alert.alert(
        "Image too large",
        "This photo is larger than 2MB. Try a tighter crop or retake with lower quality."
      );
      return;
    }

    setAnalyzing(true);
    setPreviewUri(asset.uri);

    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error("Session expired. Please sign in again.");
      }

      const payload = {
        image: asset.base64,
        mimeType: normalizedMimeType,
        imageBytes
      };

      const { data, error } = await supabase.functions.invoke("analyze-food", {
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: payload
      });

      if (error) {
        const errorWithContext = error as { context?: Response; message?: string };
        const response = errorWithContext.context;
        let backendMessage = "";
        let backendCode = "";
        const status = response?.status;

        if (response) {
          try {
            const payload = await response.clone().json();
            if (typeof payload?.error === "string") backendMessage = payload.error;
            if (typeof payload?.code === "string") backendCode = payload.code;
          } catch {
            try {
              const text = await response.clone().text();
              backendMessage = text;
            } catch {
              backendMessage = "";
            }
          }
        }

        if (status === 429 && backendCode === "app_rate_limited") {
          throw new Error("Too many analysis attempts. Wait about 60 seconds, then retry.");
        }

        if (status === 429 && backendCode === "provider_rate_limited") {
          throw new Error("AI provider is busy right now. Please retry in a minute.");
        }

        if (status === 413) {
          throw new Error("Image is too large. Use a smaller/cropped image and retry.");
        }

        const message = backendMessage || errorWithContext.message || "Request failed";
        throw new Error(message);
      }

      const parsed = analyzeFoodResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("Invalid AI response format");
      }
      const responseData: AnalyzeFoodResponse = parsed.data;

      if (responseData.items.length === 0) {
        Alert.alert("No food detected", "Try a clearer photo or add items manually.");
        return;
      }

      setItems((previous) => [...previous, ...responseData.items]);
      Alert.alert("Food detected", `Found ${responseData.items.length} item(s). Review and save.`);
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", phase: "analyze-food" });
      Alert.alert("Analysis failed", error instanceof Error ? error.message : "Please try again");
    } finally {
      setAnalyzing(false);
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.55,
      base64: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible
    });

    if (!result.canceled) {
      await analyzeAsset(result.assets[0]);
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera permission required", "Allow camera access to take food photos.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.55,
      base64: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible
    });

    if (!result.canceled) {
      await analyzeAsset(result.assets[0]);
    }
  };

  const saveMeal = async () => {
    if (!items.length) {
      Alert.alert("No items", "Add at least one food item.");
      return;
    }

    try {
      await createMeal.mutateAsync({
        mealType,
        items,
        date: formatDateKey(new Date())
      });

      Alert.alert("Meal saved", "Your meal has been logged.");
      router.replace("/(tabs)/dashboard");
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", phase: "save" });
      Alert.alert("Save failed", error instanceof Error ? error.message : "Could not save meal");
    }
  };

  return (
    <AppScreen>
      <Text style={styles.title}>Add meal</Text>

      <AppCard style={{ marginBottom: 10 }}>
        <Text style={styles.sectionHeading}>Meal type</Text>
        <View style={styles.chipWrap}>
          {mealTypes.map((typeOption) => (
            <Pressable
              key={typeOption}
              onPress={() => setMealType(typeOption)}
              style={[styles.chip, typeOption === mealType && styles.chipActive]}
            >
              <Text style={[styles.chipText, typeOption === mealType && styles.chipTextActive]}>{mealLabels[typeOption]}</Text>
            </Pressable>
          ))}
        </View>
      </AppCard>

      <AppCard style={{ marginBottom: 10 }}>
        <Text style={styles.sectionHeading}>Photo analysis</Text>
        <Text style={styles.helpText}>Take a photo or upload one, then review detected items before saving.</Text>

        <TextInput
          multiline
          value={description}
          onChangeText={setDescription}
          placeholder="Optional note about dish or portion"
          placeholderTextColor="#8ea0ba"
          style={styles.descriptionInput}
        />

        <View style={styles.photoButtonRow}>
          <AppButton
            label="Take photo"
            onPress={takePhoto}
            disabled={!photoAnalysisEnabled || analyzing}
            style={{ flex: 1, marginRight: 6 }}
          />
          <AppButton
            label="Upload"
            onPress={pickFromGallery}
            disabled={!photoAnalysisEnabled || analyzing}
            variant="outline"
            style={{ flex: 1, marginLeft: 6 }}
          />
        </View>

        {!photoAnalysisEnabled ? <Text style={styles.warningText}>Photo analysis disabled in env config.</Text> : null}

        {analyzing ? (
          <View style={styles.analyzeRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ marginLeft: 8, color: colors.mutedText }}>Analyzing food...</Text>
          </View>
        ) : null}

        {previewUri ? <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="cover" /> : null}
      </AppCard>

      {items.length ? (
        <AppCard style={{ marginBottom: 10 }}>
          <View style={styles.itemsHeader}>
            <Text style={styles.sectionHeading}>Detected items</Text>
            <View style={styles.totalBadge}>
              <MaterialCommunityIcons name="lightning-bolt" size={14} color={colors.primary} />
              <Text style={styles.totalBadgeText}>{Math.round(totalCalories)} kcal</Text>
            </View>
          </View>

          {items.map((item, index) => (
            <View key={`${item.food_name}-${index}`} style={styles.itemCard}>
              <View style={styles.itemTopRow}>
                <TextInput
                  value={item.food_name}
                  onChangeText={(value) => updateItem(index, { food_name: value })}
                  style={styles.itemNameInput}
                />
                <Pressable onPress={() => removeItem(index)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>Remove</Text>
                </Pressable>
              </View>

              <View style={styles.metricsRow}>
                <MacroInput
                  label="Cal"
                  value={String(item.calories)}
                  onChange={(value) => updateItem(index, { calories: parseNumber(value) })}
                />
                <MacroInput
                  label="P"
                  value={String(item.protein)}
                  onChange={(value) => updateItem(index, { protein: parseNumber(value) })}
                />
                <MacroInput
                  label="C"
                  value={String(item.carbs)}
                  onChange={(value) => updateItem(index, { carbs: parseNumber(value) })}
                />
                <MacroInput
                  label="F"
                  value={String(item.fat)}
                  onChange={(value) => updateItem(index, { fat: parseNumber(value) })}
                  isLast
                />
              </View>
            </View>
          ))}
        </AppCard>
      ) : null}

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={styles.sectionHeading}>Manual entry</Text>

        <TextInput
          value={manualName}
          onChangeText={setManualName}
          placeholder="Food name"
          placeholderTextColor="#8ea0ba"
          style={styles.manualNameInput}
        />

        <View style={styles.metricsRow}>
          <ManualInput label="Cal" value={manualCalories} onChange={setManualCalories} />
          <ManualInput label="Protein" value={manualProtein} onChange={setManualProtein} />
          <ManualInput label="Carbs" value={manualCarbs} onChange={setManualCarbs} />
          <ManualInput label="Fat" value={manualFat} onChange={setManualFat} isLast />
        </View>

        <AppButton label="Add item" onPress={addManualItem} variant="outline" />
      </AppCard>

      <AppButton label={createMeal.isPending ? "Saving..." : "Save meal"} onPress={saveMeal} disabled={createMeal.isPending || !items.length} />

      <View style={{ height: 90 }} />
    </AppScreen>
  );
}

function MacroInput({
  label,
  value,
  onChange,
  isLast = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isLast?: boolean;
}) {
  return (
    <View style={{ flex: 1, marginRight: isLast ? 0 : 6 }}>
      <Text style={styles.miniLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={styles.metricInput} />
    </View>
  );
}

function ManualInput({
  label,
  value,
  onChange,
  isLast = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isLast?: boolean;
}) {
  return (
    <View style={{ flex: 1, marginRight: isLast ? 0 : 6, marginBottom: 8 }}>
      <Text style={styles.miniLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={styles.metricInput} />
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
  sectionHeading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8
  },
  helpText: {
    color: colors.mutedText,
    fontSize: 12,
    marginBottom: 8
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: "#f0f6ff"
  },
  chipActive: {
    backgroundColor: colors.primary
  },
  chipText: {
    color: colors.mutedText,
    fontWeight: "700",
    fontSize: 12
  },
  chipTextActive: {
    color: "white"
  },
  descriptionInput: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    textAlignVertical: "top",
    backgroundColor: "#f8fbff",
    color: colors.text,
    marginBottom: 10
  },
  photoButtonRow: {
    flexDirection: "row",
    marginBottom: 4
  },
  warningText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 6
  },
  analyzeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6
  },
  previewImage: {
    width: "100%",
    height: 220,
    borderRadius: radius.md,
    marginTop: 10
  },
  itemsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2
  },
  totalBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center"
  },
  totalBadgeText: {
    color: colors.primary,
    marginLeft: 4,
    fontWeight: "700",
    fontSize: 12
  },
  itemCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "#f8fbff"
  },
  itemTopRow: {
    flexDirection: "row",
    alignItems: "center"
  },
  itemNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    backgroundColor: "white"
  },
  removeBtn: {
    marginLeft: 8,
    borderRadius: radius.pill,
    backgroundColor: "#ffe4e6",
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  removeBtnText: {
    color: "#be123c",
    fontWeight: "700",
    fontSize: 12
  },
  metricsRow: {
    flexDirection: "row",
    marginTop: 8
  },
  miniLabel: {
    color: colors.mutedText,
    fontSize: 11,
    marginBottom: 4,
    fontWeight: "600"
  },
  metricInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 7,
    backgroundColor: "white",
    color: colors.text
  },
  manualNameInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: "#f8fbff",
    color: colors.text
  }
});
