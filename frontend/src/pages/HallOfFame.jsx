import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "../lib/api";
import { Trophy, ArrowRight, Crown, Medal, Award } from "lucide-react";

export default function HallOfFame() {
  const nav = useNavigate();
  const [players, setPlayers] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/stats/leaderboard`).then((r) => r.data.players),
      axios.get(`${API}/stats/recent`).then((r) => r.data.games),
    ])
      .then(([p, g]) => {
        setPlayers(p || []);
        setRecent(g || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const rank = (i) => {
    if (i === 0) return <Crown className="w-5 h-5 text-yellow-400" />;
    if (i === 1) return <Medal className="w-5 h-5 text-gray-300" />;
    if (i === 2) return <Award className="w-5 h-5 text-amber-600" />;
    return <span className="w-5 text-center text-gray-500">{i + 1}</span>;
  };

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => nav("/")} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 flex items-center gap-1" data-testid="btn-back-home">
            <ArrowRight className="w-4 h-4" /> رجوع
          </button>
          <h1 className="text-3xl md:text-5xl font-black neon-yellow flex items-center gap-2">
            <Trophy className="w-8 h-8 md:w-12 md:h-12" /> قاعة المشاهير
          </h1>
          <div className="w-16" />
        </div>

        {loading && <div className="text-center text-gray-400 py-12">جاري التحميل...</div>}

        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card-dark p-4">
              <h2 className="text-xl font-bold mb-3">👑 أفضل اللاعبين</h2>
              {players.length === 0 && <p className="text-gray-500 text-sm">لا توجد بيانات بعد. العب أول مباراة!</p>}
              <div className="space-y-2">
                {players.map((p, i) => (
                  <div key={p.name} data-testid={`hof-${i}`} className="p-3 rounded-lg flex items-center gap-3 border" style={{ borderColor: (p.last_color || "#39FF14") + "77", background: (p.last_color || "#39FF14") + "10" }}>
                    <div className="w-8 flex items-center justify-center">{rank(i)}</div>
                    <div className="text-2xl">{p.last_icon || "🎮"}</div>
                    <div className="flex-1">
                      <div className="font-bold" style={{ color: p.last_color }}>{p.name}</div>
                      <div className="text-[11px] text-gray-500">
                        {p.games_played} مباراة · {p.total_wins} انتصار في المبارزات
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black neon-yellow">{p.victories}</div>
                      <div className="text-[10px] text-gray-500">لقب</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-dark p-4">
              <h2 className="text-xl font-bold mb-3">🕓 آخر المعارك</h2>
              {recent.length === 0 && <p className="text-gray-500 text-sm">لا توجد معارك بعد.</p>}
              <div className="space-y-2">
                {recent.map((g) => (
                  <div key={g.id} className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400 tabular">#{g.code}</span>
                      <span className="text-xs text-gray-500">{new Date(g.finished_at).toLocaleString("ar-EG")}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <Crown className="w-4 h-4 text-yellow-400" />
                      <span className="font-bold">{g.winner_name || "متعادل"}</span>
                      <span className="text-xs text-gray-500 ms-auto">{g.players.length} لاعبين</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
