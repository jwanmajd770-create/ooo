import { useEffect, useState, useRef } from "react";
import { sfx } from "../lib/sfx";
import { api } from "../lib/api";
import { toast } from "sonner";
import { getVoiceFeedbackMessage } from "../lib/voiceFeedback";

export default function DuelModal({ duel, meId, players, onAnswer, onSkip, onTime, onEye, myPowerups, eyeHint, duelTimeoutMs = 12000, onPass, voiceMode = false }) {
  const effectiveTimeout = duel?.timeout_ms || duelTimeoutMs;
  const [countdown, setCountdown] = useState(null);
  const lastDuelStart = useRef(null);
  const lastTickSec = useRef(null);
  const lastResolved = useRef(false);
  const [busy, setBusy] = useState(false);
  const [wrongIdx, setWrongIdx] = useState(null);
  const [, setTick] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState("");
  const recognitionRef = useRef(null);
  const voiceActiveRef = useRef(false);
  const shouldListenRef = useRef(false);
  const voiceListeningRef = useRef(false);
  const duelRef = useRef(duel);
  const onAnswerRef = useRef(onAnswer);
  const answerRef = useRef("");
  const correctAnswerRef = useRef(null);

  // إعادة الرسم كل ربع ثانية ليتحرك العدّاد
  useEffect(() => {
    if (!duel || duel.resolved) return;
    const iv = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(iv);
  }, [duel?.started_at, duel?.resolved]);

  // Separate intro logic for empty-square claims vs player-vs-player duels
  useEffect(() => {
    if (!duel) {
      lastDuelStart.current = null;
      lastResolved.current = false;
      return;
    }
    if (lastDuelStart.current !== duel.started_at && !duel.resolved) {
      lastDuelStart.current = duel.started_at;
      sfx.resume();

      const isSolo = !duel.defender_id;
      if (isSolo) {
        setCountdown(3);
        const t1 = setTimeout(() => setCountdown(2), 1000);
        const t2 = setTimeout(() => setCountdown(1), 2000);
        const t3 = setTimeout(() => {
          sfx.duelStart();
          setCountdown("انطلق!");
        }, 3000);
        const t4 = setTimeout(() => {
          setCountdown(null);
        }, 3600);
        return () => { [t1, t2, t3, t4].forEach(clearTimeout); };
      }

      sfx.dangerSiren(5000);
      setCountdown(5);
      const t1 = setTimeout(() => { setCountdown(4); sfx.introTick(1); }, 1000);
      const t2 = setTimeout(() => { setCountdown(3); sfx.introTick(2); }, 2000);
      const t3 = setTimeout(() => { setCountdown(2); sfx.introTick(3); }, 3000);
      const t4 = setTimeout(() => { setCountdown(1); sfx.introTick(4); }, 4000);
      const t5 = setTimeout(() => { sfx.duelStart(); setCountdown("انطلق!"); sfx.introTick(5); }, 5000);
      const t6 = setTimeout(() => { setCountdown(null); }, 5600);
      return () => { [t1, t2, t3, t4, t5, t6].forEach(clearTimeout); };
    }
  }, [duel?.started_at, duel?.resolved]);

  // play sound on resolve
  useEffect(() => {
    if (!duel) return;
    if (duel.resolved && !lastResolved.current) {
      lastResolved.current = true;
      if (duel.winner_id === meId) sfx.correct();
      else if (meId && duel.winner_id && duel.winner_id !== meId) sfx.wrong();
    }
  }, [duel?.resolved, duel?.winner_id, meId]);

  useEffect(() => {
    if (!duel) return;
    const iv = setInterval(() => {
      const nowSec = Date.now() / 1000;
      const attStored = duel.attacker_stored_time ?? (duel.timeout_ms ? duel.timeout_ms / 1000 : duelTimeoutMs / 1000);
      const defStored = duel.defender_stored_time ?? (duel.timeout_ms ? duel.timeout_ms / 1000 : duelTimeoutMs / 1000);
      const attRem = duel.turn === "attacker" ? Math.max(0, attStored - (nowSec - (duel.turn_start_ts || nowSec))) : attStored;
      const defRem = duel.turn === "defender" ? Math.max(0, defStored - (nowSec - (duel.turn_start_ts || nowSec))) : defStored;
      const sec = Math.ceil(Math.min(attRem, defRem));
      if (!duel.resolved && sec <= 5 && sec > 0 && sec !== lastTickSec.current) {
        lastTickSec.current = sec;
        sfx.tick();
      }
    }, 100);
    return () => clearInterval(iv);
  }, [duel, duelTimeoutMs, meId]);

  useEffect(() => {
    duelRef.current = duel;
  }, [duel]);

  useEffect(() => {
    onAnswerRef.current = onAnswer;
  }, [onAnswer]);

  useEffect(() => {
    answerRef.current = duel?.question?.opts?.[duel?.question?.a] || "";
  }, [duel?.question?.a, duel?.question?.opts]);

  useEffect(() => {
    // الأولوية: answer_text من الـ backend (للـ flags_img)
    // ثم fallback: opts[a] إن كان a معروفاً (لن يحدث في الـ production لأن a مخفي)
    const q = duel?.question;
    if (q?.answer_text) {
      correctAnswerRef.current = q.answer_text;
    } else if (q?.opts && q?.a !== undefined) {
      correctAnswerRef.current = q.opts[q.a];
    } else {
      correctAnswerRef.current = null;
    }
  }, [duel?.question]);

  useEffect(() => {
    voiceActiveRef.current = voiceActive;
  }, [voiceActive]);

  // إنشاء SpeechRecognition مرة واحدة فقط عند mount
  // نستخدم refs (correctAnswerRef, duelRef, onAnswerRef, voiceActiveRef) داخل onresult
  // للوصول لأحدث القيم دون إعادة إنشاء الـ instance عند كل poll
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceFeedback("متصفحك لا يدعم التعرف الصوتي");
      return;
    }

    const recognition = new SpeechRecognition();
    // continuous = true: يبقى المايك مفتوحاً طوال دور اللاعب
    // onresult يُطلَق بشكل متكرّر مع كل جملة/عبارة يقولها اللاعب
    recognition.lang = "ar-SA";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    let hasGotResult = false;
    let langFallbackTried = false;

    recognition.onstart = () => {
      hasGotResult = false;
      voiceListeningRef.current = true;
      console.log("VOICE: started, lang =", recognition.lang);
      setVoiceListening(true);
      setVoiceFeedback("🎤 يستمع... تكلّم الآن");
      setVoiceInterim("");
    };

    recognition.onend = () => {
      voiceListeningRef.current = false;
      console.log("VOICE: ended (gotResult:", hasGotResult, ", shouldListen:", shouldListenRef.current, ")");
      setVoiceListening(false);

      // لا نعيد التشغيل تلقائياً بعد end؛ هذا يمنع الوميض والتوقف المتكرر.
      if (!hasGotResult && !langFallbackTried && recognition.lang === "ar-SA" && shouldListenRef.current) {
        langFallbackTried = true;
        recognition.lang = "ar-EG";
        console.log("VOICE: language fallback prepared, but not auto-restarted");
        setVoiceFeedback("جارٍ انتظار التحدث..." );
      }
    };

    recognition.onerror = (e) => {
      console.error("VOICE: error", { error: e?.error, message: e?.message });
      if (e?.error === "no-speech" || e?.error === "aborted") {
        setVoiceFeedback("لم أسمع صوتًا واضحًا — حاول مرة أخرى");
        return;
      }
      if (e?.error === "network") {
        setVoiceFeedback("تعذر الوصول إلى خدمة التعرف الصوتي الآن. جرّب لاحقًا أو استخدم الإجابة اليدوية");
        shouldListenRef.current = false;
        return;
      }
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed" || e?.error === "audio-capture") {
        setVoiceFeedback(getVoiceFeedbackMessage(e?.error));
        shouldListenRef.current = false;
        return;
      }
      setVoiceFeedback(getVoiceFeedbackMessage(e?.error));
    };

    recognition.onresult = (event) => {
      // في continuous mode: event.results يتراكم — نأخذ آخر نتيجة فقط
      const results = Array.from(event.results || []);
      const latest = results[results.length - 1];
      const transcript = (latest?.[0]?.transcript || "").trim();
      if (!transcript) return;

      // نتيجة interim (اللاعب لا يزال يتكلم) — نعرضها ونستمر
      if (!latest?.isFinal) {
        setVoiceInterim(transcript);
        return;
      }

      hasGotResult = true;
      console.log("VOICE: final result:", transcript);
      setVoiceInterim("");

      // قارن بالإجابة الصحيحة (نستخدم ref للحصول على أحدث قيمة)
      const answerText = correctAnswerRef.current || "";
      const isMatch = isVoiceAnswerMatch(transcript, answerText);
      console.log("VOICE: match result", { transcript, answerText, isMatch });

      if (isMatch) {
        // ✅ إجابة صحيحة — احسب index الإجابة من opts (لأن duel.question.a مخفي في الـ production)
        const currentDuel = duelRef.current;
        const opts = currentDuel?.question?.opts || [];
        let correctIdx = opts.findIndex((opt) => normalizeArabic(opt) === normalizeArabic(answerText));
        if (correctIdx < 0) correctIdx = currentDuel?.question?.a ?? 0; // fallback
        console.log("VOICE: submitting answer at index", correctIdx);

        setVoiceFeedback(`✅ ${transcript}`);
        shouldListenRef.current = false;
        voiceActiveRef.current = false;
        setVoiceActive(false);
        try { recognition.stop(); } catch (_) {}
        onAnswerRef.current?.(correctIdx);
      } else {
        // ❌ لم يطابق — لا نعيد تشغيل الاستماع تلقائياً؛ نترك المايك مفتوحاً حتى يغيّر المستخدم الدور أو يوقفه
        setVoiceFeedback(`سمعتك: "${transcript}" — استمر بالمحاولة`);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      try { recognition.stop(); } catch (_) {}
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // إنشاء مرة واحدة فقط — يمنع تدمير الـ instance أثناء الاستماع بسبب polling

  // 🎤 auto-listen: افتح المايك تلقائياً لصاحب الدور الحالي في مبارزة flags_img
  // - Solo (خانة فارغة): المايك مفتوح للمهاجم فقط ← عند التطابق، يحتل الخانة فوراً
  // - Duel (مهاجم vs مدافع): المايك يفتح لصاحب الدور. عند إجابة صحيحة، الدور ينتقل تلقائياً للطرف الآخر (من الـ backend)
  useEffect(() => {
    if (!duel || duel.resolved) {
      shouldListenRef.current = false;
      return;
    }
    const isSolo = !duel.defender_id;
    const isMyTurn = isSolo
      ? meId === duel.attacker_id
      : (
          (duel.turn === "attacker" && meId === duel.attacker_id) ||
          (duel.turn === "defender" && meId === duel.defender_id)
        );
    const myVoiceTurn = Boolean(
      voiceMode &&
      duel.category === "flags_img" &&
      meId &&
      isMyTurn
    );
    if (!myVoiceTurn) {
      if (shouldListenRef.current) {
        shouldListenRef.current = false;
        voiceActiveRef.current = false;
        setVoiceActive(false);
        setVoiceListening(false);
        try { recognitionRef.current?.stop(); } catch (_) {}
      }
      return;
    }
    if (!recognitionRef.current) return;
    if (shouldListenRef.current) return;
    shouldListenRef.current = true;
    voiceActiveRef.current = true;
    setVoiceActive(true);
    setVoiceFeedback("🎤 يستمع... تكلّم الآن");
    try {
      recognitionRef.current.start();
    } catch (e) {
      if (e?.name !== "InvalidStateError") {
        console.warn("VOICE: auto-start failed", e?.message);
      }
      setVoiceFeedback("تعذر بدء المايكروفون. جرّب مرة أخرى أو استخدم الإجابة اليدوية");
    }
  }, [voiceMode, meId, duel?.attacker_id, duel?.defender_id, duel?.category, duel?.turn, duel?.resolved, duel?.started_at]);

  const normalizeArabic = (value, preserveSpaces = false) => {
    let normalized = (value || "")
      .toString()
      .normalize("NFKD")
      // 1) إزالة كل التشكيل والحركات (فتحة، ضمة، كسرة، شدة، تنوين، سكون...)
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
      // 2) إزالة التطويل (كشيدة)
      .replace(/\u0640/g, "")
      // 3) توحيد الألف: أ إ آ ٱ → ا
      .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
      // 4) توحيد الياء: ى → ي
      .replace(/\u0649/g, "\u064A")
      // 5) توحيد التاء المربوطة: ة → ه
      .replace(/\u0629/g, "\u0647")
      // 6) توحيد الهمزات: ؤ → و ، ئ → ي ، ء → (حذف)
      .replace(/\u0624/g, "\u0648")
      .replace(/\u0626/g, "\u064A")
      .replace(/\u0621/g, "");

    if (preserveSpaces) {
      normalized = normalized
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    } else {
      normalized = normalized
        .replace(/\s+/g, "")
        .replace(/[^\p{L}\p{N}]/gu, "");
    }

    return normalized.toLowerCase();
  };

  const isVoiceAnswerMatch = (transcript, answerText) => {
    const normalizedT = normalizeArabic(transcript);
    const normalizedA = normalizeArabic(answerText);

    if (!normalizedT || !normalizedA) return false;
    if (normalizedT === normalizedA) return true;
    if (normalizedT.includes(normalizedA) || normalizedA.includes(normalizedT)) return true;

    const wordsT = normalizeArabic(transcript, true).split(/\s+/).filter(Boolean);
    const wordsA = normalizeArabic(answerText, true).split(/\s+/).filter(Boolean);
    if (!wordsT.length || !wordsA.length) return false;

    const sharedWords = wordsT.filter((word) => wordsA.includes(word));
    return sharedWords.length > 0 && sharedWords.length >= Math.max(1, Math.min(wordsA.length, wordsT.length) - 1);
  };

  if (!duel) return null;
  const attacker = players.find((p) => p.id === duel.attacker_id);
  const defender = duel.defender_id ? players.find((p) => p.id === duel.defender_id) : null;
  const amInvolved = meId && (meId === duel.attacker_id || meId === duel.defender_id);
  const showResult = duel.resolved;
  const correct = showResult ? duel.question.a : null;
  const nowSec = Date.now() / 1000;
  const isTurnBased = duel.turn === "attacker" || duel.turn === "defender";
  const myRole = meId === duel.attacker_id ? 'attacker' : meId === duel.defender_id ? 'defender' : null;
  const alreadyAnswered = showResult || (isTurnBased && duel.turn !== myRole);
  const totalSec = (duel.timeout_ms ? duel.timeout_ms : duelTimeoutMs) / 1000;
  const isSolo = !duel.defender_id;
  const attStored = duel.attacker_stored_time ?? totalSec;
  const defStored = duel.defender_stored_time ?? totalSec;
  const introActive = countdown !== null;
  const turnElapsed = introActive ? 0 : Math.max(0, nowSec - (duel.turn_start_ts || nowSec));
  const attRem = isTurnBased
    ? (duel.turn === "attacker" ? Math.max(0, attStored - turnElapsed) : attStored)
    : totalSec;
  const defRem = isTurnBased
    ? (duel.turn === "defender" ? Math.max(0, defStored - turnElapsed) : defStored)
    : totalSec;
  const danger = (isTurnBased ? (duel.turn === "attacker" ? attRem : defRem) : totalSec) <= 3 && !showResult;
  const introOverlayColor = typeof countdown === 'number' && !isSolo ? (countdown % 2 === 0 ? 'rgba(255, 0, 0, 0.32)' : 'rgba(0, 0, 255, 0.32)') : 'rgba(0, 0, 0, 0.95)';
  const showSoloIntro = countdown !== null && isSolo;
  const showDuelIntro = countdown !== null && !isSolo;
  const useVoiceInput = Boolean(voiceMode && duel && duel.category === "flags_img" && meId && (meId === duel.attacker_id || meId === duel.defender_id) && !showResult);
  const isMyVoiceTurn = useVoiceInput && (
    isSolo
      ? meId === duel.attacker_id
      : (
          (duel.turn === "attacker" && meId === duel.attacker_id) ||
          (duel.turn === "defender" && meId === duel.defender_id)
        )
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl p-3 overflow-y-auto">
      {showSoloIntro && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 pointer-events-none">
          <div className="text-[9rem] md:text-[14rem] font-black neon-cyan animate-pulse tabular drop-shadow-[0_0_35px_rgba(0,240,255,0.65)]" data-testid="countdown">
            {countdown}
          </div>
        </div>
      )}
      {showDuelIntro && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-black/95" />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.08) 16%, rgba(0,0,0,0.96) 48%), linear-gradient(90deg, ${introOverlayColor} 0%, ${introOverlayColor === 'rgba(0, 0, 0, 0.95)' ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255,255,255,0.08)' } 100%)`,
              boxShadow: "inset 0 0 120px rgba(0,0,0,0.95)",
            }}
          />
          <div className="relative z-10 text-[9rem] md:text-[14rem] font-black neon-cyan animate-pulse tabular drop-shadow-[0_0_35px_rgba(0,240,255,0.65)]" data-testid="countdown">
            {countdown}
          </div>
        </div>
      )}
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-right">
            <div className="text-xs text-gray-500">المهاجم</div>
            <div className={`font-bold ${duel.turn === 'attacker' ? 'pulse-glow' : ''}`} style={{ color: attacker?.color }}>{attacker?.icon} {attacker?.name}</div>
            {!isSolo && <div className={`text-4xl font-black tabular mt-2 ${duel.turn === 'attacker' ? 'text-white' : 'text-gray-400'}`} data-testid="attacker-timer">{Math.ceil(attRem)}</div>}
          </div>
          <div className="flex flex-col items-center">
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${duel.turn === 'attacker' ? 'bg-cyan-400 text-black' : 'bg-gray-700 text-white'}`}>{isSolo ? 'غزو خانة فارغة' : (duel.turn === 'attacker' ? 'دور المهاجم' : duel.turn === 'defender' ? 'دور المدافع' : 'مبارزة')}</div>
          </div>
          <div className="text-left">
            <div className="text-xs text-gray-500">{defender ? "المدافع" : "غزو أرض"}</div>
            <div className={`font-bold ${duel.turn === 'defender' ? 'pulse-glow' : ''}`} style={{ color: defender?.color || "#39FF14" }}>
              {defender ? `${defender.icon} ${defender.name}` : "🏳️ خانة فارغة"}
            </div>
            <div className={`text-4xl font-black tabular mt-2 ${duel.turn === 'defender' ? 'text-white' : 'text-gray-400'}`} data-testid="defender-timer">{isSolo ? '' : Math.ceil(defRem)}</div>
          </div>
        </div>

        <div className="card-dark p-6 md:p-8 mb-4 relative">
          <div className="absolute -top-3 right-6 px-3 py-1 rounded-full bg-cyan-400 text-black text-xs font-bold">
            الفئة: {duel.category}
          </div>
          {duel.question.img ? (
            <div className="mb-6 flex justify-center">
              <img
                src={duel.question.img}
                alt="question"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                className="w-full max-w-[520px] max-h-[300px] object-contain rounded-xl border-2 border-white/10 shadow-2xl bg-black/40 p-2"
                data-testid="duel-image"
              />
            </div>
          ) : (
            <h2 className="text-2xl md:text-3xl font-bold mb-6 mt-2 leading-relaxed" data-testid="duel-question">{duel.question.q}</h2>
          )}
          {useVoiceInput ? (
            <div className="flex flex-col items-center gap-4 py-4" data-testid="voice-panel">
              <div
                className={`relative flex items-center justify-center rounded-full transition-all ${
                  voiceListening
                    ? "bg-cyan-500/30 border-4 border-cyan-400 shadow-[0_0_40px_rgba(0,240,255,0.6)] animate-pulse"
                    : isMyVoiceTurn
                      ? "bg-white/5 border-2 border-white/20"
                      : "bg-white/5 border-2 border-white/10 opacity-40"
                }`}
                style={{ width: 120, height: 120 }}
              >
                <span className="text-6xl">🎤</span>
                {voiceListening && (
                  <>
                    <span className="absolute inset-0 rounded-full border-2 border-cyan-400/60 animate-ping" />
                    <span className="absolute inset-[-8px] rounded-full border border-cyan-400/30 animate-ping" style={{ animationDelay: "0.4s" }} />
                  </>
                )}
              </div>
              <div className="text-center min-h-[3rem]">
                {isMyVoiceTurn ? (
                  <>
                    {voiceFeedback && (
                      <div className="text-base font-bold text-cyan-300" data-testid="voice-feedback">
                        {voiceFeedback}
                      </div>
                    )}
                    {voiceInterim && (
                      <div className="text-lg mt-2 text-white/90 tracking-wide" data-testid="voice-interim">
                        "{voiceInterim}"
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-base font-bold text-yellow-300/80" data-testid="voice-waiting">
                    ⏳ دور الخصم — انتظر
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-2 text-center">
                {isSolo
                  ? "قل اسم البلد لتحتل الخانة فوراً"
                  : (isMyVoiceTurn ? "قل اسم البلد — الدور ينتقل للخصم عند الإجابة الصحيحة" : "المايك مغلق أثناء دور الخصم")}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {duel.question.opts.map((opt, i) => {
                const isCorrect = showResult && i === correct;
                const isHiddenByEye = eyeHint === i && !showResult;
                const optImg = duel.question.opts_img && duel.question.opts_img[i];
                return (
                  <button
                    key={i}
                    data-testid={`answer-${i}`}
                    disabled={!amInvolved || showResult || isHiddenByEye || (isTurnBased ? duel.turn !== myRole : alreadyAnswered) || busy}
                    onClick={async () => {
                      if (busy) return;
                      setBusy(true);
                      try {
                        const res = await onAnswer(i);
                        if (res && res.correct === false) {
                          setWrongIdx(i);
                          sfx.wrong();
                          setTimeout(() => setWrongIdx(null), 600);
                        } else {
                          sfx.correct();
                        }
                      } catch (e) {
                        toast.error(e?.response?.data?.detail || 'فشل');
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className={`p-4 rounded-xl text-base md:text-lg font-bold border-2 transition-all text-right ${
                      (wrongIdx === i)
                        ? "border-red-500 bg-red-500/20 animate-shake"
                        : isHiddenByEye
                        ? "opacity-20 line-through border-red-500/30 bg-red-500/10"
                        : isCorrect
                        ? "border-green-400 bg-green-400/20"
                        : "border-white/10 bg-[#1A1A24] hover:bg-white/10 hover:border-white/30 disabled:opacity-40"
                    }`}
                  >
                    {optImg ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-gray-500 text-xs">{["أ", "ب", "ج", "د"][i]}</span>
                        <img src={optImg} alt={`option ${i}`} onError={(e) => { e.currentTarget.style.display='none'; }} className="w-24 h-16 md:w-32 md:h-20 object-contain rounded border border-white/10 bg-black/30" />
                      </div>
                    ) : (
                      <>
                        <span className="text-gray-500 ms-2">{["أ", "ب", "ج", "د"][i]}.</span>
                        {opt}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {showResult && (
            <div className="mt-6 text-center">
              <div className="text-2xl font-bold mb-2">
                {duel.winner_id === duel.attacker_id ? (
                  <span className="neon-green">✅ {attacker?.name} احتل الأرض!</span>
                ) : duel.winner_id === duel.defender_id ? (
                  <span className="neon-pink">🛡️ {defender?.name} دافع بنجاح</span>
                ) : (
                  <span className="text-gray-400">✗ فشل الغزو</span>
                )}
              </div>
            </div>
          )}
        </div>

        {amInvolved && !alreadyAnswered && !showResult && myPowerups && (
          <div className="flex justify-center gap-2 flex-wrap">
            <button data-testid="pu-skip" disabled={!myPowerups.skip} onClick={onSkip} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-xs border border-white/10 disabled:opacity-30">
              🔄 تبديل ({myPowerups.skip})
            </button>
            <button data-testid="pu-time" disabled={!myPowerups.time} onClick={onTime} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-xs border border-white/10 disabled:opacity-30">
              ⏱️ +5 ثواني ({myPowerups.time})
            </button>
            <button data-testid="pu-eye" disabled={!myPowerups.eye || eyeHint !== null && eyeHint !== undefined} onClick={onEye} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-xs border border-white/10 disabled:opacity-30">
              👁️ حذف خطأ ({myPowerups.eye})
            </button>
          </div>
        )}

        {/* Pass button for stored-clock duels: visible only to active player on their turn */}
        {duel && duel.turn && myRole && duel.turn === myRole && !showResult && (
          <div className="flex justify-center mt-3">
            <button
              data-testid="duel-pass"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  await onPass();
                } catch (e) {
                  // onPass already shows toast on error in PlayerRoom; still catch
                } finally {
                  setBusy(false);
                }
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-500 disabled:opacity-40"
            >
              تجاوز (-3 ثوان)
            </button>
          </div>
        )}

        {alreadyAnswered && !showResult && (
          <div className="text-center text-gray-400 text-sm">أرسلت إجابتك. بانتظار الخصم...</div>
        )}
      </div>
    </div>
  );
}
