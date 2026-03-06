import { useEffect, useMemo, useRef, useState } from "react";
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
import { handleCalorieTarget } from "@/lib/calorieTarget";
import { getSupabaseClient } from "@/lib/supabase";
import {
  useCreateMealTemplate,
  useCustomFoods,
  useLookupFoodByBarcode,
  useMealTemplates,
  useRecentFoods,
  useTouchMealTemplate,
  useUpsertCustomFood
} from "@/hooks/useFoods";
import { enqueueOfflineMealLog, isLikelyOfflineError } from "@/hooks/useOfflineMealQueue";
import { useCreateMeal, useMealsByDate } from "@/hooks/useMeals";
import { useProfile } from "@/hooks/useProfile";
import { useAds } from "@/providers/AdsProvider";
import type { AnalyzeFoodResponse, MealItem, MealType } from "@/shared/schemas";
import { analyzeFoodResponseSchema } from "@/shared/schemas";
import { AppScreen } from "@/components/layout/AppScreen";
import { AppCard } from "@/components/ui/AppCard";
import { AppButton } from "@/components/ui/AppButton";
import { AdBanner } from "@/components/ads/AdBanner";
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

function createClientRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AddMealScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const createMeal = useCreateMeal();
  const { data: profile } = useProfile();
  const { maybeShowInterstitial } = useAds();
  const todayKey = formatDateKey(new Date());
  const { data: todayMeals = [] } = useMealsByDate(todayKey);
  const { data: recentFoods = [] } = useRecentFoods(8);
  const [customFoodSearch, setCustomFoodSearch] = useState("");
  const { data: customFoods = [] } = useCustomFoods(customFoodSearch);
  const { data: mealTemplates = [] } = useMealTemplates();
  const saveCustomFood = useUpsertCustomFood();
  const createTemplate = useCreateMealTemplate();
  const touchTemplate = useTouchMealTemplate();
  const lookupFoodByBarcode = useLookupFoodByBarcode();

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
  const [barcodeInput, setBarcodeInput] = useState("");
  const [templateName, setTemplateName] = useState("");
  const saveLockRef = useRef(false);
  const saveRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof type === "string" && isMealType(type)) {
      setMealType(type);
    }
  }, [type]);

  const totalCalories = useMemo(
    () => items.reduce((sum, item) => sum + (Number.isFinite(item.calories) ? item.calories : 0), 0),
    [items]
  );
  const currentCalories = useMemo(
    () => todayMeals.reduce((sum, meal) => sum + (Number.isFinite(meal.total_calories ?? NaN) ? meal.total_calories ?? 0 : 0), 0),
    [todayMeals]
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

  const addItemFromPreset = (item: { food_name: string; serving_size: string; calories: number; protein: number; carbs: number; fat: number }) => {
    setItems((previous) => [
      ...previous,
      {
        food_name: item.food_name,
        quantity: 1,
        serving_size: item.serving_size,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat
      }
    ]);
  };

  const saveManualAsCustomFood = async () => {
    if (!manualName.trim()) {
      Alert.alert("Missing name", "Enter a food name first.");
      return;
    }

    try {
      await saveCustomFood.mutateAsync({
        name: manualName.trim(),
        barcode: barcodeInput.trim() || null,
        servingSize: "1 serving",
        calories: parseNumber(manualCalories),
        protein: parseNumber(manualProtein),
        carbs: parseNumber(manualCarbs),
        fat: parseNumber(manualFat)
      });
      Alert.alert("Saved", "Custom food saved.");
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", action: "save-custom-food" });
      Alert.alert("Save failed", error instanceof Error ? error.message : "Could not save custom food");
    }
  };

  const saveCurrentAsTemplate = async () => {
    if (!items.length) {
      Alert.alert("No items", "Add items before saving a template.");
      return;
    }

    if (!templateName.trim()) {
      Alert.alert("Template name required", "Enter a template name.");
      return;
    }

    try {
      await createTemplate.mutateAsync({
        name: templateName.trim(),
        mealType,
        items
      });
      setTemplateName("");
      Alert.alert("Template saved", "You can reuse it from the quick templates section.");
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", action: "save-template" });
      Alert.alert("Template save failed", error instanceof Error ? error.message : "Could not save template");
    }
  };

  const applyTemplate = async (templateId: string) => {
    const template = mealTemplates.find((entry) => entry.id === templateId);
    if (!template?.meal_template_items?.length) return;

    const nextItems = template.meal_template_items
      .sort((a, b) => a.client_item_index - b.client_item_index)
      .map((item) => ({
        food_name: item.food_name,
        quantity: item.quantity,
        serving_size: item.serving_size,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat
      }));

    setItems((previous) => [...previous, ...nextItems]);
    try {
      await touchTemplate.mutateAsync(template.id);
    } catch {
      // Best-effort metadata update only.
    }
  };

  const addFoodByBarcode = async () => {
    if (!barcodeInput.trim()) {
      Alert.alert("Barcode required", "Enter a barcode value.");
      return;
    }

    try {
      const food = await lookupFoodByBarcode.mutateAsync(barcodeInput.trim());
      if (!food) {
        Alert.alert("Not found", "No custom food with that barcode. Save one first.");
        return;
      }

      addItemFromPreset({
        food_name: food.name,
        serving_size: food.serving_size,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat
      });
      Alert.alert("Added", `${food.name} added to meal items.`);
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", action: "barcode-lookup" });
      Alert.alert("Lookup failed", error instanceof Error ? error.message : "Could not lookup barcode");
    }
  };

  const updateItem = (index: number, patch: Partial<MealItem>) => {
    setItems((previous) => previous.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const resetFormAfterSave = () => {
    setDescription("");
    setPreviewUri(null);
    setItems([]);
    setManualName("");
    setManualCalories("");
    setManualProtein("");
    setManualCarbs("");
    setManualFat("");
    setBarcodeInput("");
    setTemplateName("");
    saveRequestIdRef.current = null;
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

        if (backendCode === "provider_data_policy_blocked") {
          throw new Error(
            "AI provider blocked by OpenRouter privacy policy. Update OpenRouter Privacy settings or switch to a compatible paid model."
          );
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
      await maybeShowInterstitial("analysis_completed");
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
    if (saveLockRef.current || createMeal.isPending) {
      return;
    }

    if (!items.length) {
      Alert.alert("No items", "Add at least one food item.");
      return;
    }

    saveLockRef.current = true;
    const requestId = saveRequestIdRef.current ?? createClientRequestId();
    saveRequestIdRef.current = requestId;

    try {
      await createMeal.mutateAsync({
        mealType,
        items,
        date: todayKey,
        requestId
      });

      resetFormAfterSave();
      const dailyGoal = profile?.daily_calorie_goal ?? 2000;
      const nextCalories = currentCalories + totalCalories;
      const targetStatus = handleCalorieTarget(currentCalories, nextCalories, dailyGoal);
      let message = "Your meal has been logged.";

      if (targetStatus === "just_met") {
        message = "Your meal has been logged. Target reached for today.";
      } else if (targetStatus === "over") {
        message = `Your meal has been logged. You are ${Math.round(nextCalories - dailyGoal)} kcal over today.`;
      }

      Alert.alert("Meal saved", message);
      router.replace("/(tabs)/dashboard");
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", phase: "save" });
      if (isLikelyOfflineError(error)) {
        await enqueueOfflineMealLog({
          mealType,
          items,
          date: todayKey,
          requestId
        });
        resetFormAfterSave();
        Alert.alert("Saved offline", "Meal queued locally and will retry automatically when connection returns.");
        router.replace("/(tabs)/dashboard");
      } else {
        Alert.alert("Save failed", error instanceof Error ? error.message : "Could not save meal");
      }
    } finally {
      saveLockRef.current = false;
    }
  };

  return (
    <AppScreen>
      <Text style={styles.title}>Add meal</Text>
      <AdBanner />

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
        <Text style={styles.sectionHeading}>Quick add: recent foods</Text>
        {recentFoods.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {recentFoods.map((food) => (
              <Pressable
                key={food.id}
                onPress={() =>
                  addItemFromPreset({
                    food_name: food.food_name,
                    serving_size: food.serving_size,
                    calories: food.calories,
                    protein: food.protein,
                    carbs: food.carbs,
                    fat: food.fat
                  })
                }
                style={styles.quickFoodChip}
              >
                <Text style={styles.quickFoodName}>{food.food_name}</Text>
                <Text style={styles.quickFoodMeta}>{food.calories} kcal</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.helpText}>Your recent foods appear here after the first logs.</Text>
        )}
      </AppCard>

      <AppCard style={{ marginBottom: 10 }}>
        <Text style={styles.sectionHeading}>Barcode scan / lookup</Text>
        <TextInput
          value={barcodeInput}
          onChangeText={setBarcodeInput}
          placeholder="Enter barcode number"
          placeholderTextColor="#8ea0ba"
          style={styles.manualNameInput}
        />
        <AppButton
          label={lookupFoodByBarcode.isPending ? "Looking up..." : "Add from barcode"}
          onPress={addFoodByBarcode}
          disabled={lookupFoodByBarcode.isPending}
          variant="outline"
          style={{ marginTop: 8 }}
        />
      </AppCard>

      <AppCard style={{ marginBottom: 10 }}>
        <Text style={styles.sectionHeading}>Custom foods</Text>
        <TextInput
          value={customFoodSearch}
          onChangeText={setCustomFoodSearch}
          placeholder="Search custom food"
          placeholderTextColor="#8ea0ba"
          style={styles.manualNameInput}
        />
        <View style={{ marginTop: 8 }}>
          {customFoods.slice(0, 6).map((food) => (
            <Pressable
              key={food.id}
              onPress={() =>
                addItemFromPreset({
                  food_name: food.name,
                  serving_size: food.serving_size,
                  calories: food.calories,
                  protein: food.protein,
                  carbs: food.carbs,
                  fat: food.fat
                })
              }
              style={styles.quickRow}
            >
              <Text style={styles.quickFoodName}>{food.name}</Text>
              <Text style={styles.quickFoodMeta}>{food.calories} kcal</Text>
            </Pressable>
          ))}
          {!customFoods.length ? <Text style={styles.helpText}>No custom foods yet.</Text> : null}
        </View>
      </AppCard>

      <AppCard style={{ marginBottom: 10 }}>
        <Text style={styles.sectionHeading}>Meal templates</Text>
        {mealTemplates.length ? (
          mealTemplates.slice(0, 6).map((template) => (
            <Pressable key={template.id} onPress={() => void applyTemplate(template.id)} style={styles.quickRow}>
              <Text style={styles.quickFoodName}>{template.name}</Text>
              <Text style={styles.quickFoodMeta}>
                {template.meal_template_items?.length ?? 0} item{(template.meal_template_items?.length ?? 0) === 1 ? "" : "s"}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.helpText}>Save a meal as template to reuse it quickly.</Text>
        )}
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

        <View style={{ flexDirection: "row", gap: 8 }}>
          <AppButton label="Add item" onPress={addManualItem} variant="outline" style={{ flex: 1 }} />
          <AppButton
            label={saveCustomFood.isPending ? "Saving..." : "Save custom"}
            onPress={() => void saveManualAsCustomFood()}
            variant="outline"
            disabled={saveCustomFood.isPending}
            style={{ flex: 1 }}
          />
        </View>
      </AppCard>

      <AppCard style={{ marginBottom: 12 }}>
        <Text style={styles.sectionHeading}>Save as template</Text>
        <TextInput
          value={templateName}
          onChangeText={setTemplateName}
          placeholder="Template name"
          placeholderTextColor="#8ea0ba"
          style={styles.manualNameInput}
        />
        <AppButton
          label={createTemplate.isPending ? "Saving template..." : "Save current items as template"}
          onPress={() => void saveCurrentAsTemplate()}
          disabled={createTemplate.isPending}
          variant="outline"
          style={{ marginTop: 8 }}
        />
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
  },
  quickFoodChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fbff",
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8
  },
  quickFoodName: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 12
  },
  quickFoodMeta: {
    color: colors.mutedText,
    fontSize: 11,
    marginTop: 2
  },
  quickRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8fbff"
  }
});
