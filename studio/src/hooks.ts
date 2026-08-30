import { useCallback, useEffect, useState } from "react";
import { RECIPES_CHANGED } from "./api";
import { getWebMCPStatus, onWebMCPStatus, type WebMCPStatus } from "./webmcp";

/** Runs an async loader; re-runs when deps change or when recipes change (UI or WebMCP tool). */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    loader()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    window.addEventListener(RECIPES_CHANGED, reload);
    return () => window.removeEventListener(RECIPES_CHANGED, reload);
  }, [reload]);

  return { data, error, loading, reload };
}

export function useWebMCPStatus(): WebMCPStatus {
  const [status, setStatus] = useState<WebMCPStatus>(getWebMCPStatus());
  useEffect(() => onWebMCPStatus(setStatus), []);
  return status;
}

/** Debounced value. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useCopy(): [copied: boolean, copy: (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);
  return [copied, copy];
}
