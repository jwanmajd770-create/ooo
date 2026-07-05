import { useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useGameState } from "../hooks/useGameState";
import { api } from "../lib/api";
import GameGrid from "../components/GameGrid";
import DuelModal from "../components/DuelModal";
import Leaderboard from "../components/Leaderboard";
import CustomQuestionForm from "../components/CustomQuestionForm";
import { toast } from "sonner";
import { Copy, PlayCircle, SkipForward, Trophy } from "lucide-react";

export default function HostRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const hostToken = localStorage.getItem(`host_${code}`);
  const { state, error } = useGameState(code, hostToken, 700);

  useEffect(() => {
    if (!hostToken) nav("/");
  }, [hostToken, nav]);

  if (error) return <div className="p-6 text-red-400">{error}</div>;
  if (!state) return <div className="p-6 text-center">جاري التحميل...</div>;

  const start = async () => {
    try {
      await api.start(code, hostToken);
      toast.success("بدأت المعركة!");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "فشل");
    }
  };

  const nextTurn = async () => {
    try {
      await api.nextTurn(code, hostToken);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "فشل");
    }
  };

  const copyPin = () => {
    navigator.clipboard.writeText(code);
    toast.success("تم النسخ");
  };

  const copyLink = () => {
    const link = `${window.location.origin}/?join=${code}`;
    navigator.clipboard.writeText(link);
    toast.success("رابط الدعوة نُسخ! شاركه على واتساب");
  };

  const shields = {};
  state.players.forEach((p) => { if (p.shield_on) shields[p.id] = p.shield_on; });

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-6">
          <div>
            <div className="text-xs text-gray-500">لوحة المقدم</div>
            <div className="flex items-center gap-3">
              <h1 className="text-4xl font-black tabular neon-cyan" data-testid="host-pin">{code}</h1>
              <button onClick={copyPin} className="p-2 rounded-lg bg-white/5 hover:bg-white/10" data-testid="btn-copy-pin"><Copy className="w-4 h-4" /></button>
              <button onClick={copyLink} className="px-3 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs font-bold" data-testid="btn-copy-link">📱 نسخ رابط الدعوة</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-400">اللاعبون: {state.players.length}</span>
            <span className="text-xs text-gray-400">المشاهدون: {state.spectators.length}</span>
            {state.sudden_death && <span className="px-3 py-1 rounded-full bg-red-500 text-white text-xs font-bold animate-pulse">⚡ الموت المفاجئ</span>}
            {state.state === "lobby" && (
              <button data-testid="btn-start-game" onClick={start} disabled={state.players.length < 2} className="px-4 py-2 rounded-lg bg-cyan-400 text-black font-bold hover:bg-cyan-300 disabled:opacity-40">
                <PlayCircle className="inline w-4 h-4 ms-1" /> ابدأ المعركة
              </button>
            )}
            {state.state === "active" && state.pending_action?.type === "duel_review" && (
              <button data-testid="btn-next-turn" onClick={nextTurn} className="px-4 py-2 rounded-lg bg-pink-500 text-white font-bold hover:bg-pink-400">
                <SkipForward className="inline w-4 h-4 ms-1" /> الدور التالي
              </button>
            )}
          </div>
        </div>

        {state.state === "lobby" && (
          <div className="card-dark p-6 mb-6">
            <h2 className="text-2xl font-bold mb-3">ردهة الانتظار</h2>
            <p className="text-gray-400 mb-4 text-sm">شارك الرمز <span className="neon-cyan font-black text-lg tabular">{code}</span> مع اللاعبين. الحد الأدنى 2 لاعبين.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {state.players.map((p) => (
                <div key={p.id} className="p-3 rounded-lg border-2 flex items-center gap-2" style={{ borderColor: p.color, background: p.color + "15" }}>
                  <span className="text-2xl">{p.icon}</span>
                  <div>
                    <div className="font-bold">{p.name}</div>
                    <div className="text-xs opacity-70">{p.category_name}</div>
                  </div>
                </div>
              ))}
              {state.players.length === 0 && <div className="text-gray-500 col-span-full text-center p-6">لم ينضم أحد بعد...</div>}
            </div>
            <div className="mt-4">
              <CustomQuestionForm code={code} hostToken={hostToken} />
            </div>
          </div>
        )}

        {state.state !== "lobby" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <GameGrid
                grid={state.grid}
                players={state.players}
                currentPlayer={state.current_player}
                target={state.duel?.target}
                shields={shields}
              />
            </div>
            <div>
              <Leaderboard players={state.players} currentPlayer={state.current_player} />
            </div>
          </div>
        )}

        {state.state === "finished" && (
          <div className="fixed inset-0 z-40 bg-black/90 flex flex-col items-center justify-center p-6">
            <Trophy className="w-24 h-24 text-yellow-400 mb-4" />
            <h1 className="text-5xl font-black neon-yellow mb-2" data-testid="winner-name">
              {state.players.find((p) => p.id === state.winner)?.name || "متعادل"}
            </h1>
            <p className="text-gray-400 mb-6">هو ملك الأرض! 👑</p>
            <button onClick={() => nav("/")} className="px-6 py-3 rounded-lg bg-cyan-400 text-black font-bold">العودة للرئيسية</button>
          </div>
        )}

        <DuelModal duel={state.duel} meId={null} players={state.players} onAnswer={() => {}} myPowerups={null} duelTimeoutMs={state.duel_timeout_ms} />
      </div>
    </div>
  );
}
