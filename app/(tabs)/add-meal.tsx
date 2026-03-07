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
const mealIcons: Record<MealType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  breakfast: "coffee-outline",
  lunch: "white-balance-sunny",
  dinner: "moon-waning-crescent",
  snack: "cookie-outline"
};
const mealColors: Record<MealType, string> = {
  breakfast: "#f59e0b",
  lunch: "#10b981",
  dinner: "#6366f1",
  snack: "#f43f5e"
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

function getSafeAnalysisFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/session expired|sign in again/i.test(message)) return "Session expired. Please sign in again.";
  if (/image too large/i.test(message)) return "Image too large. Try a smaller or cropped photo.";
  if (/unsupported image format/i.test(message)) return "Unsupported image format. Use JPEG, PNG, or WEBP.";
  return "Could not analyze this photo right now. Please try again.";
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
  const [activeSection, setActiveSection] = useState<string | null>(null);
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
    setItems((prev) => [
      ...prev,
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
    setItems((prev) => [
      ...prev,
      { food_name: item.food_name, quantity: 1, serving_size: item.serving_size, calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat }
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
    if (!items.length) { Alert.alert("No items", "Add items before saving a template."); return; }
    if (!templateName.trim()) { Alert.alert("Template name required", "Enter a template name."); return; }
    try {
      await createTemplate.mutateAsync({ name: templateName.trim(), mealType, items });
      setTemplateName("");
      Alert.alert("Template saved", "You can reuse it from the quick templates section.");
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", action: "save-template" });
      Alert.alert("Template save failed", error instanceof Error ? error.message : "Could not save template");
    }
  };

  const applyTemplate = async (templateId: string) => {
    const template = mealTemplates.find((e) => e.id === templateId);
    if (!template?.meal_template_items?.length) return;
    const nextItems = template.meal_template_items
      .sort((a, b) => a.client_item_index - b.client_item_index)
      .map((item) => ({ food_name: item.food_name, quantity: item.quantity, serving_size: item.serving_size, calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat }));
    setItems((prev) => [...prev, ...nextItems]);
    try { await touchTemplate.mutateAsync(template.id); } catch {}
  };

  const addFoodByBarcode = async () => {
    if (!barcodeInput.trim()) { Alert.alert("Barcode required", "Enter a barcode value."); return; }
    try {
      const food = await lookupFoodByBarcode.mutateAsync(barcodeInput.trim());
      if (!food) { Alert.alert("Not found", "No custom food with that barcode. Save one first."); return; }
      addItemFromPreset({ food_name: food.name, serving_size: food.serving_size, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat });
      Alert.alert("Added", `${food.name} added to meal items.`);
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", action: "barcode-lookup" });
      Alert.alert("Lookup failed", error instanceof Error ? error.message : "Could not lookup barcode");
    }
  };

  const updateItem = (index: number, patch: Partial<MealItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const resetFormAfterSave = () => {
    setDescription(""); setPreviewUri(null); setItems([]);
    setManualName(""); setManualCalories(""); setManualProtein("");
    setManualCarbs(""); setManualFat(""); setBarcodeInput(""); setTemplateName("");
    saveRequestIdRef.current = null;
  };

  const analyzeAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!photoAnalysisEnabled) { Alert.alert("Photo analysis disabled", "Enable EXPO_PUBLIC_ENABLE_AI_PHOTO_ANALYSIS to use this feature."); return; }
    if (!asset.base64 || !asset.mimeType) { Alert.alert("Upload failed", "Could not read selected image."); return; }

    const normalizedMimeType = asset.mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : asset.mimeType.toLowerCase();
    const imageBytes = Math.floor((asset.base64.length * 3) / 4);

    if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
      Alert.alert("Unsupported image format", "Use a JPEG/PNG/WEBP image."); return;
    }
    if (imageBytes > MAX_IMAGE_BYTES) {
      Alert.alert("Image too large", "This photo is larger than 2MB. Try a tighter crop."); return;
    }

    setAnalyzing(true);
    setPreviewUri(asset.uri);

    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Session expired. Please sign in again.");

      const { data, error } = await supabase.functions.invoke("analyze-food", {
        headers: { Authorization: `Bearer ${token}` },
        body: { image: asset.base64, mimeType: normalizedMimeType, imageBytes }
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
            try { backendMessage = await response.clone().text(); } catch { backendMessage = ""; }
          }
        }

        if (status === 429 && backendCode === "app_rate_limited") throw new Error("Too many analysis attempts. Wait about 60 seconds, then retry.");
        if (status === 429 && backendCode === "provider_rate_limited") throw new Error("AI provider is busy right now. Please retry in a minute.");
        if (backendCode === "provider_data_policy_blocked") throw new Error("AI provider blocked by OpenRouter privacy policy.");
        if (status === 413) throw new Error("Image is too large. Use a smaller/cropped image and retry.");
        throw new Error(backendMessage || errorWithContext.message || "Request failed");
      }

      const parsed = analyzeFoodResponseSchema.safeParse(data);
      if (!parsed.success) throw new Error("Invalid AI response format");

      const responseData: AnalyzeFoodResponse = parsed.data;
      if (responseData.items.length === 0) { Alert.alert("No food detected", "Try a clearer photo or add items manually."); return; }

      setItems((prev) => [...prev, ...responseData.items]);
      await maybeShowInterstitial("analysis_completed");
      Alert.alert("Food detected", `Found ${responseData.items.length} item(s). Review and save.`);
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", phase: "analyze-food" });
      Alert.alert("Analysis failed", getSafeAnalysisFailureMessage(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const pickFromGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.55, base64: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible
    });
    if (!result.canceled) await analyzeAsset(result.assets[0]);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { Alert.alert("Camera permission required", "Allow camera access to take food photos."); return; }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.55, base64: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible
    });
    if (!result.canceled) await analyzeAsset(result.assets[0]);
  };

  const saveMeal = async () => {
    if (saveLockRef.current || createMeal.isPending) return;
    if (!items.length) { Alert.alert("No items", "Add at least one food item."); return; }

    saveLockRef.current = true;
    const requestId = saveRequestIdRef.current ?? createClientRequestId();
    saveRequestIdRef.current = requestId;

    try {
      await createMeal.mutateAsync({ mealType, items, date: todayKey, requestId });
      resetFormAfterSave();
      const dailyGoal = profile?.daily_calorie_goal ?? 2000;
      const nextCalories = currentCalories + totalCalories;
      const targetStatus = handleCalorieTarget(currentCalories, nextCalories, dailyGoal);
      let message = "Your meal has been logged.";
      if (targetStatus === "just_met") message = "Your meal has been logged. Target reached for today.";
      else if (targetStatus === "over") message = `Your meal has been logged. You are ${Math.round(nextCalories - dailyGoal)} kcal over today.`;
      Alert.alert("Meal saved", message);
      router.replace("/(tabs)/dashboard");
    } catch (error) {
      void captureClientError(error, { screen: "add-meal", phase: "save" });
      if (isLikelyOfflineError(error)) {
        await enqueueOfflineMealLog({ mealType, items, date: todayKey, requestId });
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

  const activeColor = mealColors[mealType];

  return (
    <AppScreen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Log meal</Text>
        {items.length > 0 && (
          <View style={styles.caloriePill}>
            <MaterialCommunityIcons name="lightning-bolt" size={14} color={activeColor} />
            <Text style={[styles.caloriePillText, { color: activeColor }]}>
              {Math.round(totalCalories)} kcal
            </Text>
          </View>
        )}
      </View>

      {/* Meal Type Selector */}
      <View style={styles.mealTypeRow}>
        {mealTypes.map((t) => {
          const isActive = t === mealType;
          return (
            <Pressable
              key={t}
              onPress={() => setMealType(t)}
              style={[styles.mealTypeBtn, isActive && { backgroundColor: mealColors[t], borderColor: mealColors[t] }]}
            >
              <MaterialCommunityIcons
                name={mealIcons[t]}
                size={16}
                color={isActive ? "white" : "#64748b"}
              />
              <Text style={[styles.mealTypeBtnText, isActive && styles.mealTypeBtnTextActive]}>
                {mealLabels[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Photo Analysis — prominent CTA */}
      <AppCard style={styles.photoCard}>
        <View style={styles.photoCardHeader}>
          <View style={styles.photoIconWrap}>
            <MaterialCommunityIcons name="camera-outline" size={22} color={activeColor} />
          </View>
          <View style={styles.photoCardText}>
            <Text style={styles.photoCardTitle}>Snap & analyze</Text>
            <Text style={styles.photoCardSub}>AI identifies food and calories from a photo</Text>
          </View>
        </View>

        <TextInput
          multiline
          value={description}
          onChangeText={setDescription}
          placeholder="Optional note about dish or portion…"
          placeholderTextColor="#94a3b8"
          style={styles.descriptionInput}
        />

        <View style={styles.photoButtonRow}>
          <Pressable
            onPress={takePhoto}
            disabled={!photoAnalysisEnabled || analyzing}
            style={[styles.photoCta, { backgroundColor: activeColor, opacity: (!photoAnalysisEnabled || analyzing) ? 0.5 : 1 }]}
          >
            <MaterialCommunityIcons name="camera" size={18} color="white" />
            <Text style={styles.photoCtaText}>Take photo</Text>
          </Pressable>
          <Pressable
            onPress={pickFromGallery}
            disabled={!photoAnalysisEnabled || analyzing}
            style={[styles.photoCtaOutline, { borderColor: activeColor, opacity: (!photoAnalysisEnabled || analyzing) ? 0.5 : 1 }]}
          >
            <MaterialCommunityIcons name="image-outline" size={18} color={activeColor} />
            <Text style={[styles.photoCtaOutlineText, { color: activeColor }]}>Upload</Text>
          </Pressable>
        </View>

        {analyzing && (
          <View style={styles.analyzingRow}>
            <ActivityIndicator size="small" color={activeColor} />
            <Text style={styles.analyzingText}>Analyzing food…</Text>
          </View>
        )}

        {previewUri && !analyzing && (
          <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="cover" />
        )}
      </AppCard>

      <AdBanner />

      {/* Detected / added items */}
      {items.length > 0 && (
        <AppCard style={styles.itemsCard}>
          <View style={styles.itemsHeader}>
            <Text style={styles.sectionHeading}>
              Items ({items.length})
            </Text>
            <View style={[styles.totalBadge, { backgroundColor: `${activeColor}18` }]}>
              <Text style={[styles.totalBadgeText, { color: activeColor }]}>
                {Math.round(totalCalories)} kcal total
              </Text>
            </View>
          </View>

          {items.map((item, index) => (
            <View key={`${item.food_name}-${index}`} style={styles.itemCard}>
              <View style={[styles.itemAccent, { backgroundColor: activeColor }]} />
              <View style={styles.itemBody}>
                <View style={styles.itemTopRow}>
                  <TextInput
                    value={item.food_name}
                    onChangeText={(v) => updateItem(index, { food_name: v })}
                    style={styles.itemNameInput}
                    placeholderTextColor="#94a3b8"
                  />
                  <Pressable onPress={() => removeItem(index)} style={styles.removeBtn}>
                    <MaterialCommunityIcons name="close" size={14} color="#be123c" />
                  </Pressable>
                </View>
                <View style={styles.macroRow}>
                  <MacroInput label="Cal" value={String(item.calories)} onChange={(v) => updateItem(index, { calories: parseNumber(v) })} />
                  <MacroInput label="Protein" value={String(item.protein)} onChange={(v) => updateItem(index, { protein: parseNumber(v) })} />
                  <MacroInput label="Carbs" value={String(item.carbs)} onChange={(v) => updateItem(index, { carbs: parseNumber(v) })} />
                  <MacroInput label="Fat" value={String(item.fat)} onChange={(v) => updateItem(index, { fat: parseNumber(v) })} isLast />
                </View>
              </View>
            </View>
          ))}
        </AppCard>
      )}

      {/* Recent foods */}
      {recentFoods.length > 0 && (
        <AppCard style={styles.sectionCard}>
          <Text style={styles.sectionHeading}>Recent foods</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {recentFoods.map((food) => (
              <Pressable
                key={food.id}
                onPress={() => addItemFromPreset({ food_name: food.food_name, serving_size: food.serving_size, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat })}
                style={styles.recentChip}
              >
                <Text style={styles.recentChipName} numberOfLines={1}>{food.food_name}</Text>
                <Text style={styles.recentChipCal}>{food.calories} kcal</Text>
              </Pressable>
            ))}
          </ScrollView>
        </AppCard>
      )}

      {/* Templates */}
      {mealTemplates.length > 0 && (
        <AppCard style={styles.sectionCard}>
          <Text style={styles.sectionHeading}>Templates</Text>
          {mealTemplates.slice(0, 5).map((template) => (
            <Pressable key={template.id} onPress={() => void applyTemplate(template.id)} style={styles.listRow}>
              <View style={styles.listRowLeft}>
                <MaterialCommunityIcons name="bookmark-outline" size={16} color="#64748b" />
                <Text style={styles.listRowName}>{template.name}</Text>
              </View>
              <Text style={styles.listRowMeta}>
                {template.meal_template_items?.length ?? 0} items
              </Text>
            </Pressable>
          ))}
        </AppCard>
      )}

      {/* Custom foods */}
      <AppCard style={styles.sectionCard}>
        <Text style={styles.sectionHeading}>Custom foods</Text>
        <TextInput
          value={customFoodSearch}
          onChangeText={setCustomFoodSearch}
          placeholder="Search saved foods…"
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
        />
        {customFoods.slice(0, 5).map((food) => (
          <Pressable
            key={food.id}
            onPress={() => addItemFromPreset({ food_name: food.name, serving_size: food.serving_size, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat })}
            style={styles.listRow}
          >
            <Text style={styles.listRowName}>{food.name}</Text>
            <Text style={styles.listRowMeta}>{food.calories} kcal</Text>
          </Pressable>
        ))}
        {!customFoods.length && (
          <Text style={styles.emptyHint}>No custom foods yet. Save one below.</Text>
        )}
      </AppCard>

      {/* Barcode */}
      <AppCard style={styles.sectionCard}>
        <Text style={styles.sectionHeading}>Barcode lookup</Text>
        <View style={styles.barcodeRow}>
          <TextInput
            value={barcodeInput}
            onChangeText={setBarcodeInput}
            placeholder="Enter barcode number"
            placeholderTextColor="#94a3b8"
            style={[styles.searchInput, { flex: 1, marginBottom: 0 }]}
          />
          <Pressable
            onPress={addFoodByBarcode}
            disabled={lookupFoodByBarcode.isPending}
            style={styles.barcodeBtn}
          >
            <MaterialCommunityIcons name="barcode-scan" size={18} color="white" />
          </Pressable>
        </View>
      </AppCard>

      {/* Manual entry */}
      <AppCard style={styles.sectionCard}>
        <Text style={styles.sectionHeading}>Manual entry</Text>
        <TextInput
          value={manualName}
          onChangeText={setManualName}
          placeholder="Food name"
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
        />
        <View style={styles.macroRow}>
          <ManualInput label="Cal" value={manualCalories} onChange={setManualCalories} />
          <ManualInput label="Protein" value={manualProtein} onChange={setManualProtein} />
          <ManualInput label="Carbs" value={manualCarbs} onChange={setManualCarbs} />
          <ManualInput label="Fat" value={manualFat} onChange={setManualFat} isLast />
        </View>
        <View style={styles.manualBtnRow}>
          <Pressable onPress={addManualItem} style={styles.manualBtn}>
            <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
            <Text style={styles.manualBtnText}>Add item</Text>
          </Pressable>
          <Pressable
            onPress={() => void saveManualAsCustomFood()}
            disabled={saveCustomFood.isPending}
            style={[styles.manualBtn, styles.manualBtnSecondary]}
          >
            <MaterialCommunityIcons name="content-save-outline" size={16} color="#64748b" />
            <Text style={styles.manualBtnTextSecondary}>
              {saveCustomFood.isPending ? "Saving…" : "Save custom"}
            </Text>
          </Pressable>
        </View>
      </AppCard>

      {/* Save as template */}
      {items.length > 0 && (
        <AppCard style={styles.sectionCard}>
          <Text style={styles.sectionHeading}>Save as template</Text>
          <View style={styles.barcodeRow}>
            <TextInput
              value={templateName}
              onChangeText={setTemplateName}
              placeholder="Template name"
              placeholderTextColor="#94a3b8"
              style={[styles.searchInput, { flex: 1, marginBottom: 0 }]}
            />
            <Pressable
              onPress={() => void saveCurrentAsTemplate()}
              disabled={createTemplate.isPending}
              style={styles.barcodeBtn}
            >
              <MaterialCommunityIcons name="bookmark-plus-outline" size={18} color="white" />
            </Pressable>
          </View>
        </AppCard>
      )}

      {/* Save meal CTA */}
      <Pressable
        onPress={saveMeal}
        disabled={createMeal.isPending || !items.length}
        style={[
          styles.saveCta,
          { backgroundColor: activeColor },
          (createMeal.isPending || !items.length) && styles.saveCtaDisabled
        ]}
      >
        {createMeal.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <>
            <MaterialCommunityIcons name="check-circle-outline" size={20} color="white" />
            <Text style={styles.saveCtaText}>
              Save meal{items.length > 0 ? ` · ${Math.round(totalCalories)} kcal` : ""}
            </Text>
          </>
        )}
      </Pressable>

      <View style={{ height: 100 }} />
    </AppScreen>
  );
}

function MacroInput({ label, value, onChange, isLast = false }: { label: string; value: string; onChange: (v: string) => void; isLast?: boolean }) {
  return (
    <View style={{ flex: 1, marginRight: isLast ? 0 : 6 }}>
      <Text style={styles.miniLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={styles.metricInput} />
    </View>
  );
}

function ManualInput({ label, value, onChange, isLast = false }: { label: string; value: string; onChange: (v: string) => void; isLast?: boolean }) {
  return (
    <View style={{ flex: 1, marginRight: isLast ? 0 : 6 }}>
      <Text style={styles.miniLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" style={styles.metricInput} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 14
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f172a"
  },
  caloriePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  caloriePillText: { fontWeight: "800", fontSize: 14 },

  // Meal type selector
  mealTypeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
    flexWrap: "wrap"
  },
  mealTypeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc"
  },
  mealTypeBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748b"
  },
  mealTypeBtnTextActive: { color: "white" },

  // Photo card
  photoCard: { marginBottom: 12 },
  photoCardHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  photoIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0"
  },
  photoCardText: {},
  photoCardTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  photoCardSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  descriptionInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 10,
    textAlignVertical: "top",
    minHeight: 60,
    color: "#0f172a",
    fontSize: 14,
    marginBottom: 10,
    backgroundColor: "#f8fafc"
  },
  photoButtonRow: { flexDirection: "row", gap: 8 },
  photoCta: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12
  },
  photoCtaText: { color: "white", fontWeight: "700", fontSize: 14 },
  photoCtaOutline: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    backgroundColor: "transparent"
  },
  photoCtaOutlineText: { fontWeight: "700", fontSize: 14 },
  analyzingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  analyzingText: { color: "#64748b", fontSize: 13 },
  previewImage: { width: "100%", height: 200, borderRadius: 12, marginTop: 10 },

  // Items card
  itemsCard: { marginBottom: 12 },
  itemsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  totalBadge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  totalBadgeText: { fontSize: 12, fontWeight: "800" },
  itemCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 8,
    backgroundColor: "#f8fafc"
  },
  itemAccent: { width: 4 },
  itemBody: { flex: 1, padding: 10 },
  itemTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  itemNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: "#0f172a",
    backgroundColor: "white",
    fontSize: 13,
    fontWeight: "600"
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 99,
    backgroundColor: "#fff1f2",
    alignItems: "center",
    justifyContent: "center"
  },
  macroRow: { flexDirection: "row" },
  miniLabel: { fontSize: 10, color: "#94a3b8", fontWeight: "700", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.3 },
  metricInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 6,
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "white",
    textAlign: "center"
  },

  // Section cards
  sectionCard: { marginBottom: 10 },
  sectionHeading: { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  searchInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: "#0f172a",
    fontSize: 14,
    backgroundColor: "#f8fafc",
    marginBottom: 8
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9"
  },
  listRowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  listRowName: { fontSize: 13, fontWeight: "600", color: "#0f172a" },
  listRowMeta: { fontSize: 12, color: "#94a3b8", fontWeight: "500" },
  emptyHint: { fontSize: 12, color: "#94a3b8", fontStyle: "italic" },

  // Recent chips
  recentChip: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: "#f8fafc",
    minWidth: 90
  },
  recentChipName: { fontSize: 12, fontWeight: "700", color: "#0f172a", maxWidth: 100 },
  recentChipCal: { fontSize: 11, color: "#94a3b8", marginTop: 2 },

  // Barcode
  barcodeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  barcodeBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center"
  },

  // Manual
  manualBtnRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  manualBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}10`
  },
  manualBtnText: { fontSize: 13, fontWeight: "700", color: colors.primary },
  manualBtnSecondary: { borderColor: "#e2e8f0", backgroundColor: "#f8fafc" },
  manualBtnTextSecondary: { fontSize: 13, fontWeight: "700", color: "#64748b" },

  // Save CTA
  saveCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 10
  },
  saveCtaDisabled: { opacity: 0.4 },
  saveCtaText: { color: "white", fontSize: 16, fontWeight: "800" }
});
