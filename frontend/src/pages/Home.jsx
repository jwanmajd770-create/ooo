import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Swords, Users, Eye, Zap } from "lucide-react";

const MODES = [
  { id: "classic",    title: "🎯 كلاسيكي",        desc: "كل الفئات · 12 ثانية",       color: "#22d3ee" },
  { id: "flags_only", title: "🚩 بطولة الأعلام",   desc: "أعلام فقط · 6 ثواني ⚡",      color: "#facc15" },
  { id: "football",   title: "⚽ بطولة كرة القدم", desc: "19 فئة كروية · اختر فئتك",   color: "#4ade80" },
  { id: "tournament", title: "🥇 مبارزات مباشرة", desc: "دوريات مباشرة · بطولات 1 ضد 1", color: "#fb923c" },
];

export default function Home() {
  const nav = useNavigate();
  const [gameMode, setGameMode] = useState(null); // null حتى يُختار الوضع أولاً
  const [mode, setMode] = useState(null); // null | host | join | spectate
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [categories, setCategories] = useState([]);
  const [selCat, setSelCat] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hostName, setHostName] = useState("المقدم");

  // عند اختيار الوضع، اجلب فئاته
  useEffect(() => {
    if (!gameMode) return;
    const apiMode = gameMode === "football" ? "football" : gameMode === "flags_only" ? "flags_only" : "classic";
    api.categories(apiMode).then((r) => { setCategories(r.categories); setSelCat(null); }).catch(() => {});
  }, [gameMode]);

  // دعم الرابط المباشر ?join=XXXXXX&mode=football
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (joinCode && /^\d{6}$/.test(joinCode)) {
      // اجلب وضع الغرفة تلقائياً ثم افتح الانضمام
      api.state(joinCode).then((s) => {
        const rm = s?.mode === "football" ? "football" : (s?.mode === "flags_only" ? "flags_only" : "classic");
        setGameMode(rm);
        setPin(joinCode);
        setMode("join");
      }).catch(() => {});
    }
  }, []);

  const createRoom = async () => {
    setLoading(true);
    try {
      const r = await api.createRoom(hostName || "المقدم", gameMode);
      localStorage.setItem(`host_${r.code}`, r.host_token);
      nav(`/host/${r.code}`);
    } catch (e) {
      toast.error("فشل إنشاء الغرفة");
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!pin || !name || !selCat) {
      toast.error("أكمل جميع الحقول");
      return;
    }
    setLoading(true);
    try {
      // تحقق أن وضع الغرفة يطابق الوضع المختار
      const s = await api.state(pin);
      const roomMode = s?.mode || "classic";
      if (roomMode !== gameMode) {
        const names = { classic: "الكلاسيكي", flags_only: "بطولة الأعلام", football: "بطولة كرة القدم" };
        toast.error(`هذه الغرفة مخصصة لوضع «${names[roomMode] || roomMode}» وليس «${names[gameMode] || gameMode}»`);
        setLoading(false);
        return;
      }
      const r = await api.join(pin, name, selCat);
      localStorage.setItem(`player_${pin}`, JSON.stringify({ token: r.token, id: r.player_id, name, category_id: selCat }));
      nav(`/play/${pin}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "فشل الانضمام — تأكد من الرمز");
    } finally {
      setLoading(false);
    }
  };

  const spectateRoom = async () => {
    if (!pin || !name) {
      toast.error("أدخل الاسم والرمز");
      return;
    }
    setLoading(true);
    try {
      await api.spectate(pin, name);
      localStorage.setItem(`spec_${pin}`, name);
      nav(`/watch/${pin}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "فشل الدخول");
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => { setMode(null); setPin(""); setName(""); setSelCat(null); };
  const backToModes = () => { resetAll(); setGameMode(null); };

  const currentModeMeta = MODES.find((m) => m.id === gameMode);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8 relative">
      <div className="scanlines absolute inset-0 pointer-events-none" />
      <div className="w-full max-w-3xl relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-6xl md:text-8xl font-black tracking-tight mb-2 neon-cyan" data-testid="game-title">
            الأرض
          </h1>
          <p className="text-lg md:text-xl text-gray-400 font-light">اغزُ الشبكة. اهزم خصومك. كن الأخير الصامد.</p>
          <div className="flex items-center justify-center gap-2 mt-3 text-sm text-gray-500">
            <Swords className="w-4 h-4" />
            <span>6×6 · قدرات خاصة · أوضاع متعددة</span>
          </div>
          <div className="mt-4">
            <button
              data-testid="btn-hall"
              onClick={() => nav("/hall")}
              className="text-sm text-yellow-400 hover:text-yellow-300 underline decoration-dotted underline-offset-4"
            >
              🏆 قاعة المشاهير — أفضل اللاعبين
            </button>
          </div>
        </div>

        {/* الخطوة 1: اختيار الوضع أولاً */}
        {!gameMode && (
          <div>
            <h2 className="text-center text-xl font-bold mb-4 text-gray-300">اختر وضع اللعب</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  data-testid={`mode-${m.id}`}
                  onClick={() => {
                    if (m.id === "tournament") {
                      nav("/tournament");
                      return;
                    }
                    setGameMode(m.id);
                  }}
                  className="card-dark p-6 transition-all text-center hover:scale-[1.03]"
                  style={{ borderColor: m.color + "40" }}
                >
                  <div className="text-3xl mb-2">{m.title.split(" ")[0]}</div>
                  <h3 className="text-lg font-bold mb-1">{m.title.replace(/^\S+\s/, "")}</h3>
                  <p className="text-xs text-gray-400">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* الخطوة 2: اختيار الدور (بعد اختيار الوضع) */}
        {gameMode && !mode && (
          <div>
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="text-sm text-gray-400">الوضع المختار:</span>
              <span className="font-bold" style={{ color: currentModeMeta?.color }}>{currentModeMeta?.title}</span>
              <button onClick={backToModes} className="text-xs text-gray-500 underline hover:text-gray-300 ms-2">تغيير</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                data-testid="btn-host"
                onClick={() => setMode("host")}
                className="card-dark p-6 hover:border-cyan-400/50 transition-all group text-right"
              >
                <div className="w-12 h-12 rounded-xl bg-cyan-400/10 flex items-center justify-center mb-3 group-hover:bg-cyan-400/20">
                  <Zap className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-xl font-bold mb-1">إنشاء أرض معركة</h3>
                <p className="text-sm text-gray-400">كن المقدم وأدر اللعبة</p>
              </button>
              <button
                data-testid="btn-join"
                onClick={() => setMode("join")}
                className="card-dark p-6 hover:border-pink-500/50 transition-all group text-right"
              >
                <div className="w-12 h-12 rounded-xl bg-pink-500/10 flex items-center justify-center mb-3 group-hover:bg-pink-500/20">
                  <Swords className="w-6 h-6 text-pink-500" />
                </div>
                <h3 className="text-xl font-bold mb-1">انضم كمتسابق</h3>
                <p className="text-sm text-gray-400">اختر فئتك وابدأ الغزو</p>
              </button>
              <button
                data-testid="btn-spectate"
                onClick={() => setMode("spectate")}
                className="card-dark p-6 hover:border-yellow-400/50 transition-all group text-right"
              >
                <div className="w-12 h-12 rounded-xl bg-yellow-400/10 flex items-center justify-center mb-3 group-hover:bg-yellow-400/20">
                  <Eye className="w-6 h-6 text-yellow-400" />
                </div>
                <h3 className="text-xl font-bold mb-1">شاهد كجمهور</h3>
                <p className="text-sm text-gray-400">تابع المعركة لحظياً</p>
              </button>
            </div>
          </div>
        )}

        {mode === "host" && (
          <div className="card-dark p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">إنشاء غرفة جديدة</h2>
              <span className="text-sm font-bold" style={{ color: currentModeMeta?.color }}>{currentModeMeta?.title}</span>
            </div>
            <input
              data-testid="input-host-name"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="اسم المقدم"
              className="w-full p-3 rounded-lg bg-black/50 border border-white/10 mb-4 text-white"
            />
            <div className="flex gap-2">
              <button data-testid="btn-create-room" disabled={loading} onClick={createRoom} className="flex-1 p-3 rounded-lg bg-cyan-400 text-black font-bold hover:bg-cyan-300 transition-all disabled:opacity-50">
                {loading ? "..." : "أنشئ الغرفة"}
              </button>
              <button onClick={resetAll} className="p-3 rounded-lg bg-white/5 hover:bg-white/10">رجوع</button>
            </div>
          </div>
        )}

        {mode === "join" && (
          <div className="card-dark p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">انضم كمتسابق</h2>
              <span className="text-sm font-bold" style={{ color: currentModeMeta?.color }}>{currentModeMeta?.title}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <input
                data-testid="input-pin"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="رمز الغرفة (6 أرقام)"
                className="p-3 rounded-lg bg-black/50 border border-white/10 tabular text-center text-2xl tracking-widest"
              />
              <input
                data-testid="input-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسمك"
                className="p-3 rounded-lg bg-black/50 border border-white/10"
              />
            </div>
            <label className="block text-sm mb-2 text-gray-400"><Users className="inline w-4 h-4 ms-1" />اختر فئتك المعرفية:</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 max-h-64 overflow-y-auto p-1">
              {categories.map((c) => (
                <button
                  key={c.id}
                  data-testid={`cat-${c.id}`}
                  onClick={() => setSelCat(c.id)}
                  className={`p-3 rounded-lg border transition-all text-sm text-right ${selCat === c.id ? "border-2" : "border border-white/10 hover:border-white/30"}`}
                  style={selCat === c.id ? { borderColor: c.color, background: c.color + "18", boxShadow: `0 0 15px ${c.color}55` } : {}}
                >
                  <div className="text-2xl mb-1">{c.icon}</div>
                  <div className="font-bold">{c.name}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button data-testid="btn-join-submit" disabled={loading} onClick={joinRoom} className="flex-1 p-3 rounded-lg bg-pink-500 text-white font-bold hover:bg-pink-400 transition-all disabled:opacity-50">
                {loading ? "..." : "انضم للغرفة"}
              </button>
              <button onClick={resetAll} className="p-3 rounded-lg bg-white/5 hover:bg-white/10">رجوع</button>
            </div>
          </div>
        )}

        {mode === "spectate" && (
          <div className="card-dark p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">شاهد كجمهور</h2>
              <span className="text-sm font-bold" style={{ color: currentModeMeta?.color }}>{currentModeMeta?.title}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <input
                data-testid="input-spec-pin"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="رمز الغرفة"
                className="p-3 rounded-lg bg-black/50 border border-white/10 tabular text-center text-2xl tracking-widest"
              />
              <input
                data-testid="input-spec-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسمك"
                className="p-3 rounded-lg bg-black/50 border border-white/10"
              />
            </div>
            <div className="flex gap-2">
              <button data-testid="btn-spec-submit" disabled={loading} onClick={spectateRoom} className="flex-1 p-3 rounded-lg bg-yellow-400 text-black font-bold hover:bg-yellow-300 transition-all disabled:opacity-50">
                {loading ? "..." : "ادخل"}
              </button>
              <button onClick={resetAll} className="p-3 rounded-lg bg-white/5 hover:bg-white/10">رجوع</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
