import { useParams, useNavigate } from "react-router-dom";
import { useGameState } from "../hooks/useGameState";
import GameGrid from "../components/GameGrid";
import DuelModal from "../components/DuelModal";
import Leaderboard from "../components/Leaderboard";
import { Eye, Trophy } from "lucide-react";

export default function SpectatorRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const { state, error } = useGameState(code, null, 1200);
  if (error) return <div className="p-6 text-red-400">{error}</div>;
  if (!state) return <div className="p-6 text-center">جاري التحميل...</div>;
  const shields = {};
  state.players.forEach((p) => { if (p.shield_on) shields[p.id] = p.shield_on; });

  return (
    <div className="min-h-screen p-3 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-yellow-400"><Eye className="w-5 h-5" /> <span className="text-sm">أنت تشاهد</span></div>
          <div className="tabular text-2xl font-black neon-cyan">{code}</div>
          <button onClick={() => nav("/")} className="text-xs text-gray-400 hover:text-white">خروج</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <GameGrid grid={state.grid} players={state.players} currentPlayer={state.current_player} target={state.duel?.target} shields={shields} />
          </div>
          <div>
            <Leaderboard players={state.players} currentPlayer={state.current_player} />
          </div>
        </div>
        <DuelModal duel={state.duel} meId={null} players={state.players} onAnswer={() => {}} duelTimeoutMs={state.duel_timeout_ms} />
        {state.state === "finished" && (
          <div className="fixed inset-0 z-40 bg-black/90 flex flex-col items-center justify-center p-6">
            <Trophy className="w-24 h-24 text-yellow-400 mb-4" />
            <h1 className="text-5xl font-black neon-yellow mb-2">{state.players.find((p) => p.id === state.winner)?.name} فاز!</h1>
            <button onClick={() => nav("/")} className="mt-6 px-6 py-3 rounded-lg bg-cyan-400 text-black font-bold">العودة</button>
          </div>
        )}
      </div>
    </div>
  );
}
