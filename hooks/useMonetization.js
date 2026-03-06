import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { InterstitialAd, BannerAd, AdEventType, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { initConnection, purchaseErrorListener, purchaseUpdatedListener, getProducts, requestPurchase, finishTransaction } from 'react-native-iap';

const AD_FREE_KEY = '@app:ad_free';
const PRODUCT_ID = 'remove_ads_forever'; // Must match what you set up in Play Store / App Store

// Use TestIds in development, swap for real IDs in production
const INTERSTITIAL_ID = __DEV__ ? TestIds.INTERSTITIAL : 'ca-app-pub-XXXX/XXXX';
const BANNER_ID       = __DEV__ ? TestIds.BANNER       : 'ca-app-pub-XXXX/XXXX';

export function useMonetization() {
  const [isAdFree, setIsAdFree]     = useState(false);
  const [isLoading, setIsLoading]   = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);

  // Load persisted ad-free status on startup
  useEffect(() => {
    AsyncStorage.getItem(AD_FREE_KEY).then(value => {
      if (value === 'true') setIsAdFree(true);
      setIsLoading(false);
    });
  }, []);

  // Set up IAP connection & listeners
  useEffect(() => {
    initConnection();

    const purchaseListener = purchaseUpdatedListener(async (purchase) => {
      if (purchase.productId === PRODUCT_ID) {
        await finishTransaction({ purchase });            // Acknowledge the purchase
        await AsyncStorage.setItem(AD_FREE_KEY, 'true'); // Persist permanently
        setIsAdFree(true);
        setIsPurchasing(false);
      }
    });

    const errorListener = purchaseErrorListener((error) => {
      console.warn('Purchase error:', error);
      setIsPurchasing(false);
    });

    return () => {
      purchaseListener.remove();
      errorListener.remove();
    };
  }, []);

  const buyAdFree = async () => {
    try {
      setIsPurchasing(true);
      await requestPurchase({ sku: PRODUCT_ID });
    } catch (err) {
      console.warn(err);
      setIsPurchasing(false);
    }
  };

  return { isAdFree, isLoading, isPurchasing, buyAdFree, BANNER_ID };
}