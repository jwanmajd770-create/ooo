import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, API } from "../lib/api";
import { toast } from "sonner";

const MODES = [
  { id: "classic", title: "كلاسيكي" },
  { id: "flags_only", title: "أعلام" },
  { id: "football", title: "كرة قدم" },
];

export default function Tournament() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [hostName, setHostName] = useState("المقدم");
  const [name, setName] = useState("");
  const [mode, setMode] = useState("classic");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [answer, setAnswer] = useState("");

  useEffect(() => {
    const apiMode = mode === "football" ? "football" : mode === "flags_only" ? "flags_only" : "classic";
    api.categories(apiMode).then((r) => {
      setCategories(r.categories || []);
      if (r.categories?.length) setCategory(r.categories[0].id);
    }).catch(() => {});
  }, [mode]);

  const createRoom = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/tournament/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_name: hostName, mode }),
      }).then((res) => res.json());
      setCode(r.code);
      setRoom({ code: r.code, host_token: r.host_token, mode });
      toast.success("تم إنشاء غرفة المباريات المباشرة");
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
      const r = await fetch(`${API}/tournament/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, category_id: category }),
      }).then((res) => res.json());
      setToken(r.token);
      setPlayerId(r.player_id);
      toast.success("تم الانضمام إلى البطولة");
      await refreshState();
    } catch {
      toast.error("فشل الانضمام");
    } finally {
      setLoading(false);
    }
  };

  const startTournament = async () => {
    if (!room?.host_token) return;
    setLoading(true);
    try {
      await fetch(`${API}/tournament/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room.code, host_token: room.host_token }),
      }).then((res) => res.json());
      await refreshState();
      toast.success("بدأت البطولة");
    } catch {
      toast.error("فشل البدء");
    } finally {
      setLoading(false);
    }
  };

  const refreshState = async () => {
    if (!code) return;
    try {
      const data = await fetch(`${API}/tournament/${code}/state`).then((res) => res.json());
      setRoom(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => refreshState(), 2000);
    return () => clearInterval(timer);
  }, [code]);

  const submitAnswer = async () => {
    if (!code || !token || !answer) return;
    try {
      const r = await fetch(`${API}/tournament/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, player_token: token, answer_idx: Number(answer) }),
      }).then((res) => res.json());
      if (r.ok) {
        toast.success(r.match_finished ? "انتهت المباراة" : "تم تسجيل الإجابة");
        await refreshState();
      }
    } catch {
      toast.error("فشل إرسال الإجابة");
    }
  };

  const currentMatch = room?.current_match;
  const bracket = room?.bracket || [];
  const players = room?.players || [];
  const playerMap = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);

  return (
    <div className="min-h-screen px-4 py-8 text-white" dir="rtl">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-orange-400">مبارزات مباشرة</h1>
            <p className="text-gray-400">بطولة 1 ضد 1 · أفضل 3 جولات · مشاهد مباشر</p>
          </div>
          <button onClick={() => navigate("/")} className="rounded-lg border border-white/10 px-4 py-2">العودة</button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-gray-400">اختر وضع البطولة</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full rounded-lg bg-black/50 p-3">
                {MODES.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm text-gray-400">اسم المقدم</label>
              <input value={hostName} onChange={(e) => setHostName(e.target.value)} className="w-full rounded-lg bg-black/50 p-3" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={createRoom} disabled={loading} className="rounded-lg bg-orange-500 px-4 py-2 font-bold">إنشاء بطولة</button>
            <button onClick={startTournament} disabled={!room || loading} className="rounded-lg bg-cyan-500 px-4 py-2 font-bold">بدء البطولة</button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">القبضة الرئيسية</h2>
              <span className="text-sm text-gray-400">الرمز: {code || "—"}</span>
            </div>

            {currentMatch && currentMatch.status === "active" ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
                  <p className="text-sm text-orange-300">المبارزة الحالية</p>
                  <div className="mt-2 flex items-center justify-between">
                    <div>
                      <p className="font-bold">{playerMap[currentMatch.players?.[0]]?.name || "—"}</p>
                      <p className="text-sm text-gray-400">VS</p>
                      <p className="font-bold">{playerMap[currentMatch.players?.[1]]?.name || "—"}</p>
                    </div>
                    <div className="text-right text-sm text-gray-400">
                      <p>الجولة: {currentMatch.round_number}</p>
                      <p>النتيجة: {currentMatch.scores?.[currentMatch.players?.[0]] || 0} - {currentMatch.scores?.[currentMatch.players?.[1]] || 0}</p>
                    </div>
                  </div>
                </div>

                {currentMatch.question && (
                  <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <p className="mb-3 font-bold">{currentMatch.question.q}</p>
                    <div className="grid gap-2">
                      {currentMatch.question.opts?.map((opt, idx) => (
                        <button key={idx} onClick={() => setAnswer(String(idx))} className={`rounded-lg border p-3 text-right ${answer === String(idx) ? "border-cyan-400 bg-cyan-500/20" : "border-white/10"}`}>
                          {opt}
                        </button>
                      ))}
                    </div>
                    <button onClick={submitAnswer} className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 font-bold">إرسال الإجابة</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-gray-400">
                {room?.state === "active" ? "الدرع معطل حاليًا — انتظار المباراة القادمة" : "ابدأ البطولة لرؤية الجدول واللقاءات"}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-4 text-xl font-bold">الجدول</h2>
            <div className="space-y-3">
              {bracket.length === 0 ? (
                <p className="text-gray-400">لن يظهر الجدول حتى تبدأ البطولة.</p>
              ) : bracket.map((match) => (
                <div key={match.id} className={`rounded-xl border p-3 ${match.status === "active" ? "border-orange-400" : "border-white/10"}`}>
                  <p className="text-sm text-gray-400">{match.round === 1 ? "ربع/نصف" : "نهائي"}</p>
                  <p className="font-bold">{match.players?.map((pid) => playerMap[pid]?.name || pid).join(" vs ") || "في انتظار اللاعبين"}</p>
                  <p className="text-sm text-gray-400">الحالة: {match.status}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-gray-400">رمز البطولة</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full rounded-lg bg-black/50 p-3" />
            </div>
            <div>
              <label className="mb-2 block text-sm text-gray-400">اسمك</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg bg-black/50 p-3" />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-2 block text-sm text-gray-400">اختر فئتك</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {categories.map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)} className={`rounded-lg border p-3 text-right ${category === c.id ? "border-cyan-400 bg-cyan-500/20" : "border-white/10"}`}>
                  <div className="mb-1 text-2xl">{c.icon}</div>
                  <div className="text-sm">{c.name}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={joinRoom} disabled={loading} className="rounded-lg bg-pink-500 px-4 py-2 font-bold">انضم للبطولة</button>
          </div>
        </div>
      </div>
    </div>
  );
}
