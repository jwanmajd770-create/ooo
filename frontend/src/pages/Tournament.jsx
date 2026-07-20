import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../lib/api";
import DuelModal from "../components/DuelModal";
import { toast } from "sonner";

const MODES = [
  { id: "classic", title: "كلاسيكي", icon: "🎯" },
  { id: "flags_only", title: "أعلام والصور", icon: "🚩" },
  { id: "football", title: "كرة القدم", icon: "⚽" },
];

const ROLES = [
  { id: "host", title: "مقدم", icon: "👑" },
  { id: "player", title: "متسابق", icon: "⚔️" },
];

export default function Tournament() {
  const navigate = useNavigate();
  const [step, setStep] = useState("mode");
  const [mode, setMode] = useState("classic");
  const [role, setRole] = useState("host");
  const [hostName, setHostName] = useState("المقدم");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [room, setRoom] = useState(null);
  const [hostToken, setHostToken] = useState("");
  const [playerToken, setPlayerToken] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const apiMode = mode === "football" ? "football" : mode === "flags_only" ? "flags_only" : "classic";
    fetch(`${API}/categories?mode=${apiMode}`)
      .then((res) => res.json())
      .then((data) => {
        const items = data.categories || [];
        setCategories(items);
        if (!items.some((item) => item.id === category)) {
          setCategory(items[0]?.id || "");
        }
      })
      .catch(() => {});
  }, [category, mode]);

  const refreshState = useCallback(async (roomCode = code) => {
    if (!roomCode) return;
    try {
      const data = await fetch(`${API}/tournament/${roomCode}/state`).then((res) => res.json());
      setRoom(data);

      if (data.state === "bracket" && step !== "bracket") {
        setStep("bracket");
      } else if (data.state === "match" && step !== "match") {
        setStep("match");
      } else if (data.state === "finished" && step !== "finished") {
        setStep("finished");
      }
    } catch {
      // ignore
    }
  }, [code, step]);

  useEffect(() => {
    if (!code || !["host-lobby", "player-lobby", "bracket", "match"].includes(step)) return;
    const timer = setInterval(() => refreshState(code), 2000);
    return () => clearInterval(timer);
  }, [code, refreshState, step]);

  const createRoom = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/tournament/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_name: hostName || "المقدم", mode }),
      });
      const data = await res.json();
      setCode(data.code);
      setHostToken(data.host_token);
      setPlayerToken("");
      setPlayerId("");
      setRoom({ code: data.code, host_name: hostName || "المقدم", mode, state: "lobby", players: [], bracket: [] });
      setStep("host-lobby");
      toast.success("تم إنشاء غرفة جديدة");
    } catch {
      toast.error("فشل إنشاء الغرفة");
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!code || !name || !category) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/tournament/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, category_id: category }),
      });
      const data = await res.json();
      setPlayerToken(data.token);
      setPlayerId(data.player_id);
      await refreshState(code);
      setStep("player-lobby");
      toast.success("تم الانضمام إلى البطولة");
    } catch {
      toast.error("فشل الانضمام");
    } finally {
      setLoading(false);
    }
  };

  const startTournament = async () => {
    if (!code || !hostToken) return;
    setLoading(true);
    try {
      await fetch(`${API}/tournament/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, host_token: hostToken }),
      });
      await refreshState(code);
      setStep("bracket");
      toast.success("بدأت البطولة");
    } catch {
      toast.error("فشل بدء البطولة");
    } finally {
      setLoading(false);
    }
  };

  const startMatch = async (matchId) => {
    if (!code || !hostToken) return;
    setLoading(true);
    try {
      await fetch(`${API}/tournament/start-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, host_token: hostToken, match_id: matchId }),
      });
      await refreshState(code);
      setStep("match");
      toast.success("بدأت المباراة");
    } catch {
      toast.error("فشل بدء المباراة");
    } finally {
      setLoading(false);
    }
  };

  const answerTournament = async (idx) => {
    if (!code || !playerToken) {
      throw new Error("لم يتم تسجيل اللاعب");
    }
    const res = await fetch(`${API}/tournament/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, player_token: playerToken, answer_idx: idx }),
    });
    const data = await res.json();
    await refreshState(code);
    return data;
  };

  const playerMap = useMemo(() => Object.fromEntries((room?.players || []).map((player) => [player.id, player])), [room]);
  const currentMatch = useMemo(() => room?.bracket?.find((match) => match.id === room.current_match_id) || null, [room]);
  const myRole = useMemo(() => {
    const players = currentMatch?.players || [];
    if (playerId && players[0] === playerId) return "attacker";
    if (playerId && players[1] === playerId) return "defender";
    return "spectator";
  }, [currentMatch, playerId]);

  const duelForModal = useMemo(() => {
    if (!room || !currentMatch || room.state !== "match") return null;
    const [attackerId, defenderId] = currentMatch.players || [];
    const attacker = room.players?.find((player) => player.id === attackerId) || null;
    const defender = room.players?.find((player) => player.id === defenderId) || null;
    return {
      attacker_id: attackerId,
      defender_id: defenderId || null,
      attacker_answered: false,
      defender_answered: false,
      question: currentMatch.question || { q: "لا توجد أسئلة", opts: ["أ", "ب", "ج", "د"], a: 0 },
      category: currentMatch.category_name || "مبارزة",
      resolved: false,
      winner_id: null,
      started_at: Date.now(),
      timeout_ms: 12000,
      turn: currentMatch.active_player_id === attackerId ? "attacker" : "defender",
      turn_start_ts: Date.now() / 1000,
      attacker_stored_time: 12,
      defender_stored_time: 12,
      attacker_answer: null,
      defender_answer: null,
      scores: currentMatch.scores || {},
    };
  }, [currentMatch, room]);

  return (
    <div className="min-h-screen bg-[#05070b] px-4 py-8 text-white" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-orange-400">مبارزات مباشرة</h1>
            <p className="text-gray-400">تدفق واضح · اختيار الوضع ثم الدور ثم الغرفة</p>
          </div>
          <button onClick={() => navigate("/")} className="rounded-lg border border-white/10 px-4 py-2">
            العودة
          </button>
        </div>

        {step === "mode" && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-lg font-bold">الخطوة 1: اختر الوضع</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setMode(item.id);
                    setStep("role");
                  }}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-right"
                >
                  <div className="text-3xl">{item.icon}</div>
                  <div className="mt-2 font-bold">{item.title}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "role" && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-lg font-bold">الخطوة 2: اختر الدور</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {ROLES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setRole(item.id);
                    setStep(item.id === "host" ? "host-form" : "player-form");
                  }}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-right"
                >
                  <div className="text-3xl">{item.icon}</div>
                  <div className="mt-2 font-bold">{item.title}</div>
                </button>
              ))}
            </div>
            <div className="mt-4">
              <button onClick={() => setStep("mode")} className="rounded-lg border border-white/10 px-4 py-2">
                رجوع
              </button>
            </div>
          </div>
        )}

        {step === "host-form" && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-lg font-bold">الخطوة 3: إنشاء غرفة</h2>
            <label className="mb-2 block text-sm text-gray-400">اسم المقدم</label>
            <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="المقدم" className="w-full rounded-lg bg-black/50 p-3" />
            <button onClick={createRoom} disabled={loading} className="mt-4 w-full rounded-lg bg-orange-500 px-4 py-3 font-bold disabled:opacity-60">
              إنشاء غرفة
            </button>
          </div>
        )}

        {step === "host-lobby" && room && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">غرفة الاستقبال</h2>
              <span className="text-2xl font-black text-orange-400">{room.code}</span>
            </div>
            <p className="mb-4 text-gray-400">رمز الغرفة أعلاه. انتظر اللاعبين ثم ابدأ البطولة عندما يصبحوا اثنين أو أكثر.</p>
            <div className="grid gap-2">
              {room.players?.length ? room.players.map((player) => (
                <div key={player.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                  <span>{player.name}</span>
                  <span className="text-sm text-gray-400">{player.category_name}</span>
                </div>
              )) : <p className="text-gray-400">لا يوجد لاعبين بعد.</p>}
            </div>
            {room.players?.length >= 2 && (
              <button onClick={startTournament} disabled={loading} className="mt-4 rounded-lg bg-green-600 px-4 py-3 font-bold disabled:opacity-60">
                ابدأ البطولة
              </button>
            )}
          </div>
        )}

        {step === "player-form" && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-lg font-bold">الخطوة 3: انضم إلى غرفة</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm text-gray-400">رمز الغرفة</label>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full rounded-lg bg-black/50 p-3" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-gray-400">اسمك</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg bg-black/50 p-3" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-gray-400">الفئة</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg bg-black/50 p-3">
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button onClick={joinRoom} disabled={loading || !code || !name || !category} className="mt-4 rounded-lg bg-cyan-500 px-4 py-3 font-bold disabled:opacity-60">
              انضم
            </button>
          </div>
        )}

        {step === "player-lobby" && room && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-xl font-bold">في انتظار بدء البطولة...</h2>
            <p className="mb-4 text-gray-400">سيظهر الجدول هنا بمجرد أن يبدأ المقدم البطولة.</p>
            <div className="grid gap-2">
              {room.players?.length ? room.players.map((player) => (
                <div key={player.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                  <span>{player.name}</span>
                  <span className="text-sm text-gray-400">{player.category_name}</span>
                </div>
              )) : <p className="text-gray-400">لا يوجد لاعبين بعد.</p>}
            </div>
          </div>
        )}

        {step === "bracket" && room && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold">الجدول - دور خروج المغلوب</h2>
                <span className="text-sm text-gray-400">الرمز: {room.code}</span>
              </div>
              <div className="space-y-3">
                {room.bracket?.length ? room.bracket.map((match) => {
                  const isActive = room.current_match_id === match.id;
                  const isFinished = match.status === "finished";
                  const isPending = match.status === "pending";
                  const winner = match.winner_id ? playerMap[match.winner_id] : null;
                  const playersLabel = match.players?.length
                    ? match.players.map((pid) => playerMap[pid]?.name || "—").join(" vs ")
                    : "في انتظار اللاعب";

                  return (
                    <div
                      key={match.id}
                      className={`rounded-xl border p-3 ${isActive ? "border-orange-400 bg-orange-500/10" : isFinished ? "border-green-500/30 bg-green-500/10" : "border-white/10 bg-white/5"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-gray-400">{match.label}</p>
                          <p className="mt-1 font-bold">{playersLabel}</p>
                          <p className="mt-1 text-sm text-gray-400">
                            الحالة: {isFinished ? "منتهية" : isActive ? "نشطة" : "قيد الانتظار"}
                          </p>
                          {winner && <p className="mt-1 text-sm text-green-300">الفائز: {winner.name}</p>}
                        </div>
                        {role === "host" && isPending && (
                          <button onClick={() => startMatch(match.id)} disabled={loading} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-bold disabled:opacity-60">
                            ابدأ هذه المباراة
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }) : <p className="text-gray-400">لن يظهر الجدول إلا بعد بدء البطولة.</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <h2 className="text-xl font-bold">اللاعبون</h2>
              <div className="mt-4 space-y-2">
                {room.players?.length ? room.players.map((player) => (
                  <div key={player.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                    <span>{player.name}</span>
                    <span className="text-sm text-gray-400">{player.category_name}</span>
                  </div>
                )) : <p className="text-gray-400">لا يوجد لاعبين بعد.</p>}
              </div>
            </div>
          </div>
        )}

        {step === "match" && room && (
          <div className="space-y-4">
            {currentMatch && (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-gray-400">
                دورك: {myRole === "attacker" ? "مهاجم" : myRole === "defender" ? "مدافع" : "مراقب"}
              </div>
            )}
            {duelForModal && (
              <DuelModal
                duel={duelForModal}
                meId={playerId || null}
                players={room.players || []}
                onAnswer={answerTournament}
                onPass={async () => ({ ok: true })}
                onSkip={async () => {}}
                onTime={async () => {}}
                onEye={async () => {}}
                myPowerups={{}}
                eyeHint={null}
                duelTimeoutMs={12000}
              />
            )}
          </div>
        )}

        {step === "finished" && room && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-center">
            <div className="text-5xl">🏆</div>
            <h2 className="mt-3 text-2xl font-black">البطولة انتهت</h2>
            <p className="mt-2 text-gray-400">الفائز: {playerMap[room.winner_id]?.name || "—"}</p>
            <button onClick={() => navigate("/")} className="mt-6 rounded-lg bg-orange-500 px-4 py-3 font-bold">
              العودة للرئيسية
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
