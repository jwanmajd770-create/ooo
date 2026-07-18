import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export function useGameState(code, token, intervalMs = 1000) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const refreshState = useCallback(async () => {
    if (!code) return null;
    try {
      try {
        await api.tick(code);
      } catch (_) {}
      const s = await api.state(code, token);
      setState(s);
      return s;
    } catch (e) {
      const message = e?.response?.data?.detail || "خطأ في الاتصال";
      setError(message);
      throw e;
    }
  }, [code, token]);

  useEffect(() => {
    if (!code) return;
    let alive = true;

    async function poll() {
      try {
        await refreshState();
      } catch (_) {
        if (alive) {
          // keep existing error handling from the previous implementation
        }
      }
    }

    poll();
    timerRef.current = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [code, intervalMs, refreshState]);

  return { state, error, refreshState };
}
