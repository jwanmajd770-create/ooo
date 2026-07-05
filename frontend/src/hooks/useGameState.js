import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export function useGameState(code, token, intervalMs = 1000) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!code) return;
    let alive = true;

    async function poll() {
      try {
        // tick to handle timeouts server-side, ignore error
        try {
          await api.tick(code);
        } catch (_) {}
        const s = await api.state(code, token);
        if (alive) setState(s);
      } catch (e) {
        if (alive) setError(e?.response?.data?.detail || "خطأ في الاتصال");
      }
    }

    poll();
    timerRef.current = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [code, token, intervalMs]);

  return { state, error };
}
