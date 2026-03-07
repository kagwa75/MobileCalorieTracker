import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { isRetryableError, retryDelayWithBackoff } from "@/lib/resilientQuery";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 1000 * 60 * 60 * 24,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: (failureCount, error) => failureCount < 3 && isRetryableError(error),
            retryDelay: retryDelayWithBackoff
          },
          mutations: {
            retry: (failureCount, error) => failureCount < 2 && isRetryableError(error),
            retryDelay: retryDelayWithBackoff
          }
        }
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
