import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../lib/api";
import { toast } from "sonner";

const MODES = [
  { id: "classic", title: "كلاسيكي" },
  { id: "flags_only", title: "أعلام" },
  { id: "football", title: "كرة قدم" },
];

export default function Tournament() {
  const navigate = useNavigate();
  const [role, setRole] = useState("host");
  const [mode, setMode] = useState("classic");
  const [hostName, setHostName] = useState("المقدم");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [room, setRoom] = useState(null);
  const [hostToken, setHostToken] = useState("");
  const [playerToken, setPlayerToken] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const apiMode = mode === "football" ? "football" : mode === "flags_only" ? "flags_only" : "classic";
    fetch(${API}/categories?mode=)
      .then((res) => res.json())
      .then((data) => {
        setCategories(data.categories || []);
        if (data.categories?.length) setCategory(data.categories[0].id);
      })
      .catch(() => {});
  }, [mode]);

  const refreshState = async (roomCode = code) => {
    if (!roomCode) return;
    try {
      const data = await fetch(${API}/tournament//state).then((res) => res.json());
      setRoom(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => refreshState(code), 2000);
    return () => clearInterval(timer);
  }, [code]);

  const createRoom = async () => {
    setLoading(true);
    try {
      const res = await fetch(${API}/tournament/create, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_name: hostName, mode }),
      });
      const data = await res.json();
      setCode(data.code);
      setHostToken(data.host_token);
      setRoom({ code: data.code, host_name: hostName, mode, state: "lobby", players: [], bracket: [] });
      toast.success("تم إنشاء غرفة مبارزات مباشرة");
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
      const res = await fetch(${API}/tournament/join, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, category_id: category }),
      });
      const data = await res.json();
      setPlayerToken(data.token);
      setPlayerId(data.player_id);
      await refreshState(code);
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
      await fetch(${API}/tournament/start, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, host_token: hostToken }),
      });
      await refreshState(code);
      toast.success("بدأت المبارزة");
    } catch {
      toast.error("فشل البدء");
    } finally {
      setLoading(false);
    }
  };

  const nextMatch = async () => {
    if (!code || !hostToken) return;
    setLoading(true);
    try {
      await fetch(${API}/tournament/advance, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, host_token: hostToken }),
      });
      await refreshState(code);
    } catch {
      toast.error("فشل الانتقال للمبارزة التالية");
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async () => {
    if (!code || !playerToken || !answer) return;
    setLoading(true);
    try {
      await fetch(${API}/tournament/answer, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, player_token: playerToken, answer_idx: Number(answer) }),
      });
      await refreshState(code);
      setAnswer("");
    } catch {
      toast.error("فشل إرسال الإجابة");
    } finally {
      setLoading(false);
    }
  };

  const currentMatch = useMemo(() => {
    if (!room?.bracket) return null;
    return room.bracket.find((m) => m.id === room.current_match_id) || null;
  }, [room]);

  const playerMap = useMemo(() => Object.fromEntries((room?.players || []).map((p) => [p.id, p])), [room]);
  const isMyTurn = currentMatch?.active_player_id === playerId;
  const isHost = role === "host";

  return (
    <div className="min-h-screen px-4 py-8 text-white" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-orange-400">مبارزات مباشرة</h1>
            <p className="text-gray-400">بطولة 1 ضد 1 · أفضل 3 جولات</p>
          </div>
          <button onClick={() => navigate("/")} className="rounded-lg border border-white/10 px-4 py-2">العودة</button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="mb-4 flex gap-3">
            <button onClick={() => setRole("host")} className={ounded-lg px-4 py-2 }>مقدم</button>
            <button onClick={() => setRole("player")} className={ounded-lg px-4 py-2 }>متسابق</button>
          </div>

          {role === "host" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-gray-400">اختر الوضع</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full rounded-lg bg-black/50 p-3">
                  {MODES.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-gray-400">اسم المقدم</label>
                <input value={hostName} onChange={(e) => setHostName(e.target.value)} className="w-full rounded-lg bg-black/50 p-3" />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-gray-400">رمز البطولة</label>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full rounded-lg bg-black/50 p-3" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-gray-400">اسمك</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg bg-black/50 p-3" />
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {role === "host" ? (
              <>
                <button onClick={createRoom} disabled={loading} className="rounded-lg bg-orange-500 px-4 py-2 font-bold">إنشاء غرفة</button>
                <button onClick={startTournament} disabled={!code || !hostToken || loading} className="rounded-lg bg-cyan-500 px-4 py-2 font-bold">ابدأ المبارزة</button>
                <button onClick={nextMatch} disabled={!code || !hostToken || loading} className="rounded-lg bg-white/10 px-4 py-2">المبارزة التالية</button>
              </>
            ) : (
              <button onClick={joinRoom} disabled={loading} className="rounded-lg bg-cyan-500 px-4 py-2 font-bold">انضم للبطولة</button>
            )}
          </div>
        </div>

        {room && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold">القاعة</h2>
                <span className="text-sm text-gray-400">الرمز: {room.code}</span>
              </div>

              {room.state === "lobby" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <p className="text-gray-400">في انتظار اللاعبين</p>
                    <p className="mt-2 text-sm">عند دخول لاعبين اثنين أو أكثر، سيظهر الجدول. عندما يكون المقدم جاهزاً، اضغط على «ابدأ المبارزة».</p>
                  </div>
                  <div className="grid gap-2">
                    {room.players?.length ? room.players.map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                        <span>{p.name}</span>
                        <span className="text-sm text-gray-400">{p.category_name}</span>
                      </div>
                    )) : <p className="text-gray-400">لا يوجد لاعبين بعد.</p>}
                  </div>
                </div>
              ) : null}

              {room.state === "active" && currentMatch && currentMatch.status === "active" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
                    <p className="text-sm text-orange-300">مبارزة نشطة</p>
                    <div className="mt-2 flex items-center justify-between">
                      <div>
                        <p className="font-bold">{playerMap[currentMatch.players?.[0]]?.name || "—"}</p>
                        <p className="text-sm text-gray-400">VS</p>
                        <p className="font-bold">{playerMap[currentMatch.players?.[1]]?.name || "—"}</p>
                      </div>
                      <div className="text-right text-sm text-gray-400">
                        <p>الجولة: {currentMatch.current_round}</p>
                        <p>النتيجة: {currentMatch.scores?.[currentMatch.players?.[0]] || 0} - {currentMatch.scores?.[currentMatch.players?.[1]] || 0}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <p className="mb-3 font-bold">{currentMatch.question?.q}</p>
                    <div className="grid gap-2">
                      {currentMatch.question?.opts?.map((opt, idx) => (
                        <button key={idx} onClick={() => setAnswer(String(idx))} className={ounded-lg border p-3 text-right }>
                          {opt}
                        </button>
                      ))}
                    </div>

                    {isMyTurn ? (
                      <button onClick={submitAnswer} disabled={loading || !answer} className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 font-bold disabled:opacity-50">إرسال الإجابة</button>
                    ) : (
                      <p className="mt-4 text-sm text-gray-400">ينتظر اللاعب الآخر دوره.</p>
                    )}
                  </div>
                </div>
              ) : null}

              {room.state === "active" && (!currentMatch || currentMatch.status !== "active") ? (
                <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-gray-400">
                  {room.winner_id ? البطل:  : "الجدول ظاهر بين المبارزات. اضغط على «المبارزة التالية» عندما تكون جاهزاً."}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <h2 className="mb-4 text-xl font-bold">الجدول</h2>
              <div className="space-y-3">
                {room.bracket?.length ? room.bracket.map((match) => (
                  <div key={match.id} className={ounded-xl border p-3 }>
                    <p className="text-sm text-gray-400">{match.label}</p>
                    <p className="font-bold">{match.players?.length ? match.players.map((pid) => playerMap[pid]?.name || "—").join(" vs ") : "في انتظار اللاعب"}</p>
                    <p className="text-sm text-gray-400">الحالة: {match.status}</p>
                    {match.winner_id ? <p className="mt-1 text-sm text-cyan-400">الفائز: {playerMap[match.winner_id]?.name || "—"}</p> : null}
                  </div>
                )) : <p className="text-gray-400">لن يظهر الجدول إلا بعد البدء.</p>}
              </div>
            </div>
          </div>
        )}

        {role === "player" && categories.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-xl font-bold">اختر فئتك</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {categories.map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)} className={ounded-lg border p-3 text-right }>
                  <div className="mb-1 text-2xl">{c.icon}</div>
                  <div className="text-sm">{c.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
