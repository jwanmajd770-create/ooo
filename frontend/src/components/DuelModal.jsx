import { useEffect, useState, useRef } from "react";
import { sfx } from "../lib/sfx";
import { api } from "../lib/api";
import { toast } from "sonner";

export default function DuelModal({ duel, meId, players, onAnswer, onSkip, onTime, onEye, myPowerups, eyeHint, duelTimeoutMs = 12000, onPass }) {
  const effectiveTimeout = duel?.timeout_ms || duelTimeoutMs;
  const [countdown, setCountdown] = useState(null);
  const lastDuelStart = useRef(null);
  const lastTickSec = useRef(null);
  const lastResolved = useRef(false);
  const [busy, setBusy] = useState(false);
  const [wrongIdx, setWrongIdx] = useState(null);

  // countdown 3-2-1 when a new duel appears
  useEffect(() => {
    if (!duel) {
      lastDuelStart.current = null;
      lastResolved.current = false;
      return;
    }
    if (lastDuelStart.current !== duel.started_at && !duel.resolved) {
      lastDuelStart.current = duel.started_at;
      sfx.resume();
      sfx.countdown();
      setCountdown(3);
      const t1 = setTimeout(() => setCountdown(2), 1000);
      const t2 = setTimeout(() => setCountdown(1), 2000);
      const t3 = setTimeout(() => setCountdown("انطلق!"), 3000);
      const t4 = setTimeout(() => setCountdown(null), 3800);
      return () => { [t1, t2, t3, t4].forEach(clearTimeout); };
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

  if (!duel) return null;
  const attacker = players.find((p) => p.id === duel.attacker_id);
  const defender = duel.defender_id ? players.find((p) => p.id === duel.defender_id) : null;
  const amInvolved = meId && (meId === duel.attacker_id || meId === duel.defender_id);
  const alreadyAnswered = duel.resolved || (meId === duel.attacker_id ? duel.attacker_answered : meId === duel.defender_id ? duel.defender_answered : false);
  const showResult = duel.resolved;
  const correct = showResult ? duel.question.a : null;
  const nowSec = Date.now() / 1000;
  const attStored = duel.attacker_stored_time ?? (duel.timeout_ms ? duel.timeout_ms / 1000 : duelTimeoutMs / 1000);
  const defStored = duel.defender_stored_time ?? (duel.timeout_ms ? duel.timeout_ms / 1000 : duelTimeoutMs / 1000);
  const attRem = duel.turn === "attacker" ? Math.max(0, attStored - (nowSec - (duel.turn_start_ts || nowSec))) : attStored;
  const defRem = duel.turn === "defender" ? Math.max(0, defStored - (nowSec - (duel.turn_start_ts || nowSec))) : defStored;
  const danger = (duel.turn === "attacker" ? attRem : defRem) <= 3 && !showResult;
  const myRole = meId === duel.attacker_id ? 'attacker' : meId === duel.defender_id ? 'defender' : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl p-3 overflow-y-auto">
      {countdown !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 pointer-events-none">
          <div className="text-[10rem] md:text-[15rem] font-black neon-cyan animate-pulse tabular" data-testid="countdown">
            {countdown}
          </div>
        </div>
      )}
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-right">
            <div className="text-xs text-gray-500">المهاجم</div>
            <div className={`font-bold ${duel.turn === 'attacker' ? 'pulse-glow' : ''}`} style={{ color: attacker?.color }}>{attacker?.icon} {attacker?.name}</div>
            <div className={`text-4xl font-black tabular mt-2 ${duel.turn === 'attacker' ? 'text-white' : 'text-gray-400'}`} data-testid="attacker-timer">{Math.ceil(attRem)}</div>
          </div>
          <div className="flex flex-col items-center">
            <div className={`px-3 py-1 rounded-full text-xs font-bold ${duel.turn === 'attacker' ? 'bg-cyan-400 text-black' : 'bg-gray-700 text-white'}`}>{duel.turn === 'attacker' ? 'دور المهاجم' : duel.turn === 'defender' ? 'دور المدافع' : 'مبارزة'}</div>
          </div>
          <div className="text-left">
            <div className="text-xs text-gray-500">{defender ? "المدافع" : "غزو أرض"}</div>
            <div className={`font-bold ${duel.turn === 'defender' ? 'pulse-glow' : ''}`} style={{ color: defender?.color || "#39FF14" }}>
              {defender ? `${defender.icon} ${defender.name}` : "🏳️ خانة فارغة"}
            </div>
            <div className={`text-4xl font-black tabular mt-2 ${duel.turn === 'defender' ? 'text-white' : 'text-gray-400'}`} data-testid="defender-timer">{Math.ceil(defRem)}</div>
          </div>
        </div>

        <div className="card-dark p-6 md:p-8 mb-4 relative">
          <div className="absolute -top-3 right-6 px-3 py-1 rounded-full bg-cyan-400 text-black text-xs font-bold">
            الفئة: {duel.category}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-6 mt-2 leading-relaxed" data-testid="duel-question">{duel.question.q}</h2>
          {duel.question.img && (
            <div className="mb-6 flex justify-center">
              <img
                src={duel.question.img}
                alt="question"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                className="max-h-56 md:max-h-72 rounded-xl border-2 border-white/10 shadow-2xl object-contain bg-black/40 p-2"
                data-testid="duel-image"
              />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {duel.question.opts.map((opt, i) => {
              const isCorrect = showResult && i === correct;
              const myAnswer = meId === duel.attacker_id ? duel.attacker_answer : duel.defender_answer;
              const isMine = showResult && i === myAnswer;
              const isHiddenByEye = eyeHint === i && !showResult;
              const optImg = duel.question.opts_img && duel.question.opts_img[i];
              return (
                <button
                  key={i}
                  data-testid={`answer-${i}`}
                  disabled={!amInvolved || showResult || isHiddenByEye || (duel.turn ? duel.turn !== myRole : alreadyAnswered) || busy}
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
                      : isMine
                      ? "border-red-500 bg-red-500/20"
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

        {alreadyAnswered && !showResult && (
          <div className="text-center text-gray-400 text-sm">أرسلت إجابتك. بانتظار الخصم...</div>
        )}
      </div>
    </div>
  );
}
