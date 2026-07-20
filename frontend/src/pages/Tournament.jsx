import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "../lib/api";
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
  const [loading, setLoading] = useState(false);
  const [createdRoom, setCreatedRoom] = useState(null);
  const [joinedRoom, setJoinedRoom] = useState(null);

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

  const createRoom = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/rooms/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_name: hostName || "المقدم", mode }),
      });
      const data = await res.json();
      setCreatedRoom({ code: data.code, host_token: data.host_token });
      setCode(data.code);
      localStorage.setItem(`host_${data.code}`, data.host_token);
      setStep("host-ready");
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
      const res = await fetch(`${API}/rooms/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, category_id: category }),
      });
      const data = await res.json();
      setJoinedRoom({ code, player_id: data.player_id, token: data.token });
      setStep("player-ready");
      toast.success("تم الانضمام إلى الغرفة");
    } catch {
      toast.error("فشل الانضمام");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05070b] px-4 py-8 text-white" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-orange-400">مبارزات مباشرة</h1>
            <p className="text-gray-400">اختر الوضع ثم الدور ثم انضم إلى الغرفة الحالية</p>
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

        {step === "host-ready" && createdRoom && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-center">
            <h2 className="text-xl font-bold">تم إنشاء الغرفة</h2>
            <p className="mt-2 text-gray-400">رمز الغرفة: {createdRoom.code}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <button onClick={() => navigate(`/host/${createdRoom.code}`)} className="rounded-lg bg-cyan-500 px-4 py-3 font-bold">
                دخول غرفة المقدم
              </button>
              <button onClick={() => setStep("mode")} className="rounded-lg border border-white/10 px-4 py-2">
                إنشاء غرفة أخرى
              </button>
            </div>
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
              انضم إلى الغرفة
            </button>
          </div>
        )}

        {step === "player-ready" && joinedRoom && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-center">
            <h2 className="text-xl font-bold">تم الانضمام إلى الغرفة</h2>
            <p className="mt-2 text-gray-400">رمز الغرفة: {joinedRoom.code}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <button onClick={() => navigate(`/play/${joinedRoom.code}`)} className="rounded-lg bg-cyan-500 px-4 py-3 font-bold">
                دخول غرفة اللاعب
              </button>
              <button onClick={() => setStep("mode")} className="rounded-lg border border-white/10 px-4 py-2">
                الانضمام إلى غرفة أخرى
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
