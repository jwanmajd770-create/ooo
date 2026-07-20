import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../lib/api";
import { toast } from "sonner";

const MODES = [
  { id: "classic", title: "كلاسيكي", icon: "🎮" },
  { id: "flags_only", title: "أعلام والصور", icon: "🏁" },
  { id: "football", title: "كرة القدم", icon: "⚽" },
];

const ROLES = [
  { id: "host", title: "مقدم", icon: "👑" },
  { id: "player", title: "متسابق", icon: "🎯" },
];

export default function Tournament() {
  const navigate = useNavigate();
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
  const [showBracket, setShowBracket] = useState(false);
  const [step, setStep] = useState(1);

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
  }, [mode]);

  const refreshState = async (roomCode = code) => {
    if (!roomCode) return;
    try {
      const data = await fetch(`${API}/tournament/${roomCode}/state`).then((res) => res.json());
      setRoom(data);
      if (data.state === "active") {
        setShowBracket(true);
      }
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
      const res = await fetch(`${API}/tournament/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_name: hostName, mode }),
      });
      const data = await res.json();
      setCode(data.code);
      setHostToken(data.host_token);
      setRoom({ code: data.code, host_name: hostName, mode, state: "lobby", players: [], bracket: [] });
      setShowBracket(false);
      setStep(3);
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
      const res = await fetch(`${API}/tournament/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, category_id: category }),
      });
      const data = await res.json();
      setPlayerToken(data.token);
      setPlayerId(data.player_id);
      await refreshState(code);
      setShowBracket(false);
      setStep(3);
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
      setShowBracket(true);
      toast.success("بدأت المبارزة");
    } catch {
      toast.error("فشل البدء");
    } finally {
      setLoading(false);
    }
  };

  const advanceTournament = async () => {
    if (!code || !hostToken) return;
    setLoading(true);
    try {
      await fetch(`${API}/tournament/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, host_token: hostToken }),
      });
      await refreshState(code);
    } catch {
      toast.error("فشل بدء المبارزة التالية");
    } finally {
      setLoading(false);
    }
  };

  const playerMap = useMemo(() => Object.fromEntries((room?.players || []).map((p) => [p.id, p])), [room]);
  const shouldShowBracket = showBracket || room?.state === "active";

  return (
    <div className="min-h-screen bg-[#05070b] px-4 py-8 text-white" dir="rtl">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-orange-400">مبارزات مباشرة</h1>
            <p className="text-gray-400">اختيار الوضع · دور المقدم أو المتسابق</p>
          </div>
          <button onClick={() => navigate("/")} className="rounded-lg border border-white/10 px-4 py-2">العودة</button>
        </div>

        {step === 1 && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-lg font-bold">الخطوة 1: اختر الوضع</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setMode(item.id);
                    setStep(2);
                  }}
                  className={`rounded-2xl border p-4 text-right ${mode === item.id ? "border-orange-400 bg-orange-500/20" : "border-white/10 bg-white/5"}`}
                >
                  <div className="text-3xl">{item.icon}</div>
                  <div className="mt-2 font-bold">{item.title}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <h2 className="mb-3 text-lg font-bold">الخطوة 2: اختر الدور</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {ROLES.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setRole(item.id);
                    setStep(3);
                  }}
                  className={`rounded-2xl border p-4 text-right ${role === item.id ? "border-cyan-400 bg-cyan-500/20" : "border-white/10 bg-white/5"}`}
                >
                  <div className="text-3xl">{item.icon}</div>
                  <div className="mt-2 font-bold">{item.title}</div>
                </button>
              ))}
            </div>
            <div className="mt-4">
              <button onClick={() => setStep(1)} className="rounded-lg border border-white/10 px-4 py-2">
                رجوع
              </button>
            </div>
          </div>
        )}

        {step === 3 && !room && (
          <>
            {role === "host" ? (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">اسم المقدم</label>
                    <input value={hostName} onChange={(e) => setHostName(e.target.value)} className="w-full rounded-lg bg-black/50 p-3" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">الخيارات</label>
                    <button onClick={createRoom} disabled={loading} className="w-full rounded-lg bg-orange-500 px-4 py-3 font-bold disabled:opacity-60">
                      إنشاء غرفة
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
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

                <div className="mt-4">
                  <h3 className="mb-2 text-sm text-gray-400">اختر فئة من قائمة هذا الوضع</h3>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {categories.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setCategory(item.id)}
                        className={`rounded-lg border p-3 text-right ${category === item.id ? "border-cyan-400 bg-cyan-500/20" : "border-white/10 bg-white/5"}`}
                      >
                        <div className="mb-1 text-2xl">{item.icon}</div>
                        <div className="text-sm">{item.name}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <button onClick={joinRoom} disabled={loading || !code || !name || !category} className="rounded-lg bg-cyan-500 px-4 py-3 font-bold disabled:opacity-60">
                    انضم
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {room && !shouldShowBracket && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">الانتظار</h2>
              <span className="text-sm text-gray-400">الرمز: {room.code}</span>
            </div>
            <p className="mb-4 text-gray-400">
              {role === "host"
                ? "في انتظار اللاعبين. عند دخول لاعبين اثنين أو أكثر، يمكنك البدء بالمبارزة." 
                : "تم تسجيلك في الغرفة. انتظر حتى يبدأ المقدم البطولة."}
            </p>
            <div className="grid gap-2">
              {room.players?.length ? room.players.map((player) => (
                <div key={player.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                  <span>{player.name}</span>
                  <span className="text-sm text-gray-400">{player.category_name}</span>
                </div>
              )) : <p className="text-gray-400">لا يوجد لاعبين بعد.</p>}
            </div>
            {role === "host" && room.players?.length >= 2 && (
              <div className="mt-4">
                <button onClick={startTournament} disabled={loading} className="rounded-lg bg-cyan-500 px-4 py-2 font-bold disabled:opacity-60">
                  ابدأ المبارزة
                </button>
              </div>
            )}
          </div>
        )}

        {shouldShowBracket && room && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold">الجدول</h2>
                <span className="text-sm text-gray-400">الرمز: {room.code}</span>
              </div>
              <div className="space-y-3">
                {room.bracket?.length ? room.bracket.map((match) => (
                  <div key={match.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-sm text-gray-400">{match.label}</p>
                    <p className="mt-1 font-bold">
                      {match.players?.length ? match.players.map((pid) => playerMap[pid]?.name || "—").join(" vs ") : "في انتظار اللاعب"}
                    </p>
                    <p className="mt-1 text-sm text-gray-400">الحالة: {match.status}</p>
                    {role === "host" && (
                      <button onClick={advanceTournament} disabled={loading} className="mt-3 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-bold disabled:opacity-60">
                        ابدأ المبارزة
                      </button>
                    )}
                  </div>
                )) : <p className="text-gray-400">لن يظهر الجدول إلا بعد بدء البطولة.</p>}
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
      </div>
    </div>
  );
}
