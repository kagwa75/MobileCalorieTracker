import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getInterstitialUnitId, isAdRuntimeSupported } from "@/lib/ads";
import { captureClientError } from "@/lib/monitoring";

type GoogleMobileAdsModule = typeof import("react-native-google-mobile-ads");

const INTERSTITIAL_FREQUENCY_KEY = "@calorie-tracker/interstitial-frequency-v1";
// Launch tuning: increase opportunities while keeping policy-safe throttling.
const INTERSTITIAL_COOLDOWN_MS = 4 * 60 * 1000;
const INTERSTITIAL_DAILY_CAP = 6;

type InterstitialFrequencyState = {
  dateKey: string;
  shownCount: number;
  lastShownAtMs: number;
};

function getLocalDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readInterstitialFrequencyState(): Promise<InterstitialFrequencyState> {
  const fallback: InterstitialFrequencyState = {
    dateKey: getLocalDateKey(),
    shownCount: 0,
    lastShownAtMs: 0
  };

  try {
    const raw = await AsyncStorage.getItem(INTERSTITIAL_FREQUENCY_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<InterstitialFrequencyState>;
    if (typeof parsed.dateKey !== "string") return fallback;
    if (!Number.isFinite(parsed.shownCount) || !Number.isFinite(parsed.lastShownAtMs)) return fallback;

    return {
      dateKey: parsed.dateKey,
      shownCount: Math.max(0, Math.floor(Number(parsed.shownCount))),
      lastShownAtMs: Math.max(0, Math.floor(Number(parsed.lastShownAtMs)))
    };
  } catch {
    return fallback;
  }
}

async function writeInterstitialFrequencyState(next: InterstitialFrequencyState) {
  await AsyncStorage.setItem(INTERSTITIAL_FREQUENCY_KEY, JSON.stringify(next));
}

type AdsContextValue = {
  isSupported: boolean;
  isInitializing: boolean;
  canRequestAds: boolean;
  requestNonPersonalizedAdsOnly: boolean;
  privacyOptionsRequired: boolean;
  statusMessage: string | null;
  showPrivacyOptions: () => Promise<boolean>;
  maybeShowInterstitial: (trigger?: "analysis_completed" | "tab_navigation") => Promise<boolean>;
};

const AdsContext = createContext<AdsContextValue>({
  isSupported: false,
  isInitializing: false,
  canRequestAds: false,
  requestNonPersonalizedAdsOnly: true,
  privacyOptionsRequired: false,
  statusMessage: null,
  showPrivacyOptions: async () => false,
  maybeShowInterstitial: async () => false
});

export function AdsProvider({ children }: { children: React.ReactNode }) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [canRequestAds, setCanRequestAds] = useState(false);
  const [requestNonPersonalizedAdsOnly, setRequestNonPersonalizedAdsOnly] = useState(true);
  const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const isSupported = isAdRuntimeSupported();
  const interstitialRef = useRef<import("react-native-google-mobile-ads").InterstitialAd | null>(null);
  const interstitialLoadedRef = useRef(false);
  const interstitialShowingRef = useRef(false);
  const interstitialUnsubscribersRef = useRef<Array<() => void>>([]);

  const clearInterstitial = useCallback(() => {
    interstitialLoadedRef.current = false;
    interstitialShowingRef.current = false;
    interstitialRef.current = null;
    interstitialUnsubscribersRef.current.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch {
        // Ignore listener cleanup failures.
      }
    });
    interstitialUnsubscribersRef.current = [];
  }, []);

  const prepareInterstitial = useCallback(
    async (ads: GoogleMobileAdsModule, nonPersonalizedOnly: boolean, allowAdRequests: boolean) => {
      clearInterstitial();
      if (!allowAdRequests) return;

      const unitId = getInterstitialUnitId(ads.TestIds.INTERSTITIAL);
      if (!unitId) return;

      const interstitial = ads.InterstitialAd.createForAdRequest(unitId, {
        requestNonPersonalizedAdsOnly: nonPersonalizedOnly
      });

      interstitialUnsubscribersRef.current = [
        interstitial.addAdEventListener(ads.AdEventType.LOADED, () => {
          interstitialLoadedRef.current = true;
        }),
        interstitial.addAdEventListener(ads.AdEventType.CLOSED, () => {
          interstitialLoadedRef.current = false;
          interstitialShowingRef.current = false;
          interstitial.load();
        }),
        interstitial.addAdEventListener(ads.AdEventType.ERROR, (error) => {
          interstitialLoadedRef.current = false;
          interstitialShowingRef.current = false;
          void captureClientError(error, { scope: "ads", action: "interstitial-error" });
          setTimeout(() => {
            interstitial.load();
          }, 15000);
        })
      ];

      interstitialRef.current = interstitial;
      interstitialLoadedRef.current = false;
      interstitial.load();
    },
    [clearInterstitial]
  );

  useEffect(() => {
    let mounted = true;

    if (!isSupported) {
      setIsInitializing(false);
      clearInterstitial();
      return () => {
        mounted = false;
      };
    }

    const initialize = async () => {
      try {
        const ads = await import("react-native-google-mobile-ads");
        const privacyRequiredValue = ads.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;

        await ads.default().setRequestConfiguration({
          maxAdContentRating: ads.MaxAdContentRating.T,
          tagForChildDirectedTreatment: false,
          tagForUnderAgeOfConsent: false
        });

        const existingConsentInfo = await ads.AdsConsent.getConsentInfo().catch(() => null);
        if (mounted && existingConsentInfo) {
          setCanRequestAds(Boolean(existingConsentInfo.canRequestAds));
          setPrivacyOptionsRequired(existingConsentInfo.privacyOptionsRequirementStatus === privacyRequiredValue);
        }

        const gatheredConsentInfo = await ads.AdsConsent.gatherConsent({
          tagForUnderAgeOfConsent: false
        }).catch((error) => {
          void captureClientError(error, { scope: "ads", action: "gather-consent" });
          return null;
        });

        const latestConsentInfo = gatheredConsentInfo ?? existingConsentInfo;
        const nextCanRequestAds = __DEV__ ? true : Boolean(latestConsentInfo?.canRequestAds);
        const nextPrivacyOptionsRequired = latestConsentInfo?.privacyOptionsRequirementStatus === privacyRequiredValue;

        let nextRequestNonPersonalizedOnly = true;
        try {
          const choices = await ads.AdsConsent.getUserChoices();
          nextRequestNonPersonalizedOnly = !(
            choices.selectPersonalisedAds && choices.storeAndAccessInformationOnDevice
          );
        } catch (error) {
          void captureClientError(error, { scope: "ads", action: "get-user-choices" });
        }

        if (mounted) {
          setCanRequestAds(nextCanRequestAds);
          setPrivacyOptionsRequired(nextPrivacyOptionsRequired);
          setRequestNonPersonalizedAdsOnly(nextRequestNonPersonalizedOnly);
          setStatusMessage(
            nextCanRequestAds
              ? null
              : "Consent required or unavailable. Ad requests are blocked until consent can be resolved."
          );
        }

        if (nextCanRequestAds) {
          await ads.default().initialize();
          await prepareInterstitial(ads, nextRequestNonPersonalizedOnly, true);
        } else {
          clearInterstitial();
        }
      } catch (error) {
        void captureClientError(error, { scope: "ads", action: "initialize" });
        if (mounted) {
          setCanRequestAds(__DEV__);
          setPrivacyOptionsRequired(false);
          setRequestNonPersonalizedAdsOnly(true);
          setStatusMessage(error instanceof Error ? error.message : "Ad initialization failed.");
        }
        clearInterstitial();
      } finally {
        if (mounted) setIsInitializing(false);
      }
    };

    void initialize();

    return () => {
      mounted = false;
      clearInterstitial();
    };
  }, [clearInterstitial, isSupported, prepareInterstitial]);

  const showPrivacyOptions = async () => {
    if (!isSupported) return false;

    try {
      const ads = await import("react-native-google-mobile-ads");
      const info = await ads.AdsConsent.showPrivacyOptionsForm();
      const privacyRequiredValue = ads.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;

      setCanRequestAds(Boolean(info.canRequestAds));
      setPrivacyOptionsRequired(info.privacyOptionsRequirementStatus === privacyRequiredValue);
      setStatusMessage(null);

      try {
        const choices = await ads.AdsConsent.getUserChoices();
        const nonPersonalizedOnly = !(choices.selectPersonalisedAds && choices.storeAndAccessInformationOnDevice);
        setRequestNonPersonalizedAdsOnly(nonPersonalizedOnly);
        if (info.canRequestAds) {
          await ads.default().initialize();
          await prepareInterstitial(ads, nonPersonalizedOnly, true);
        } else {
          clearInterstitial();
        }
      } catch (error) {
        void captureClientError(error, { scope: "ads", action: "refresh-user-choices" });
        setRequestNonPersonalizedAdsOnly(true);
        if (info.canRequestAds) {
          await prepareInterstitial(ads, true, true);
        } else {
          clearInterstitial();
        }
      }

      return true;
    } catch (error) {
      void captureClientError(error, { scope: "ads", action: "show-privacy-options" });
      return false;
    }
  };

  const maybeShowInterstitial = useCallback(
    async (_trigger: "analysis_completed" | "tab_navigation" = "analysis_completed") => {
      if (!isSupported || !canRequestAds || isInitializing) return false;

      const interstitial = interstitialRef.current;
      if (!interstitial) return false;
      if (interstitialShowingRef.current) return false;

      if (!interstitialLoadedRef.current) {
        try {
          interstitial.load();
        } catch {
          // Best effort preload.
        }
        return false;
      }

      if (!__DEV__) {
        const now = Date.now();
        const today = getLocalDateKey();
        const frequencyState = await readInterstitialFrequencyState();
        const shownToday = frequencyState.dateKey === today ? frequencyState.shownCount : 0;
        const lastShownAtMs = frequencyState.dateKey === today ? frequencyState.lastShownAtMs : 0;

        if (shownToday >= INTERSTITIAL_DAILY_CAP) return false;
        if (lastShownAtMs > 0 && now - lastShownAtMs < INTERSTITIAL_COOLDOWN_MS) return false;

        try {
          interstitialShowingRef.current = true;
          await interstitial.show();
          await writeInterstitialFrequencyState({
            dateKey: today,
            shownCount: shownToday + 1,
            lastShownAtMs: now
          });
          return true;
        } catch (error) {
          void captureClientError(error, { scope: "ads", action: "show-interstitial" });
          try {
            interstitial.load();
          } catch {
            // Best effort reload.
          }
          return false;
        } finally {
          interstitialShowingRef.current = false;
        }
      }

      try {
        interstitialShowingRef.current = true;
        await interstitial.show();
        return true;
      } catch (error) {
        void captureClientError(error, { scope: "ads", action: "show-interstitial-dev" });
        try {
          interstitial.load();
        } catch {
          // Best effort reload.
        }
        return false;
      } finally {
        interstitialShowingRef.current = false;
      }
    },
    [canRequestAds, isInitializing, isSupported]
  );

  const value = useMemo<AdsContextValue>(
    () => ({
      isSupported,
      isInitializing,
      canRequestAds,
      requestNonPersonalizedAdsOnly,
      privacyOptionsRequired,
      statusMessage,
      showPrivacyOptions,
      maybeShowInterstitial
    }),
    [canRequestAds, isInitializing, isSupported, maybeShowInterstitial, privacyOptionsRequired, requestNonPersonalizedAdsOnly, statusMessage]
  );

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}

export function useAds() {
  return useContext(AdsContext);
}
