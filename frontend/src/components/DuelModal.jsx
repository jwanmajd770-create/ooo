import { useEffect, useState } from "react";

export default function DuelModal({ duel, meId, players, onAnswer, onSkip, onTime, onEye, myPowerups, eyeHint, duelTimeoutMs = 12000 }) {
  const [remaining, setRemaining] = useState(duelTimeoutMs / 1000);

  useEffect(() => {
    if (!duel) return;
    const iv = setInterval(() => {
      const elapsed = Date.now() - duel.started_at;
      const rem = Math.max(0, (duelTimeoutMs - elapsed) / 1000);
      setRemaining(rem);
    }, 100);
    return () => clearInterval(iv);
  }, [duel, duelTimeoutMs]);

  if (!duel) return null;
  const attacker = players.find((p) => p.id === duel.attacker_id);
  const defender = duel.defender_id ? players.find((p) => p.id === duel.defender_id) : null;
  const amInvolved = meId && (meId === duel.attacker_id || meId === duel.defender_id);
  const alreadyAnswered = duel.resolved || (meId === duel.attacker_id ? duel.attacker_answered : meId === duel.defender_id ? duel.defender_answered : false);
  const showResult = duel.resolved;
  const correct = showResult ? duel.question.a : null;
  const danger = remaining <= 3 && !showResult;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl p-3 overflow-y-auto">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-right">
            <div className="text-xs text-gray-500">المهاجم</div>
            <div className="font-bold" style={{ color: attacker?.color }}>{attacker?.icon} {attacker?.name}</div>
          </div>
          <div className={`text-6xl md:text-8xl font-black tabular ${danger ? "text-red-500 animate-pulse" : "text-white"}`} data-testid="duel-timer">
            {Math.ceil(remaining)}
          </div>
          <div className="text-left">
            <div className="text-xs text-gray-500">{defender ? "المدافع" : "غزو أرض"}</div>
            <div className="font-bold" style={{ color: defender?.color || "#39FF14" }}>
              {defender ? `${defender.icon} ${defender.name}` : "🏳️ خانة فارغة"}
            </div>
          </div>
        </div>

        <div className="card-dark p-6 md:p-8 mb-4 relative">
          <div className="absolute -top-3 right-6 px-3 py-1 rounded-full bg-cyan-400 text-black text-xs font-bold">
            الفئة: {duel.category}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-6 mt-2 leading-relaxed" data-testid="duel-question">{duel.question.q}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {duel.question.opts.map((opt, i) => {
              const isCorrect = showResult && i === correct;
              const myAnswer = meId === duel.attacker_id ? duel.attacker_answer : duel.defender_answer;
              const isMine = showResult && i === myAnswer;
              const isHiddenByEye = eyeHint === i && !showResult;
              return (
                <button
                  key={i}
                  data-testid={`answer-${i}`}
                  disabled={!amInvolved || alreadyAnswered || showResult || isHiddenByEye}
                  onClick={() => onAnswer(i)}
                  className={`p-4 rounded-xl text-base md:text-lg font-bold border-2 transition-all text-right ${
                    isHiddenByEye
                      ? "opacity-20 line-through border-red-500/30 bg-red-500/10"
                      : isCorrect
                      ? "border-green-400 bg-green-400/20"
                      : isMine
                      ? "border-red-500 bg-red-500/20"
                      : "border-white/10 bg-[#1A1A24] hover:bg-white/10 hover:border-white/30 disabled:opacity-40"
                  }`}
                >
                  <span className="text-gray-500 ms-2">{["أ", "ب", "ج", "د"][i]}.</span>
                  {opt}
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
