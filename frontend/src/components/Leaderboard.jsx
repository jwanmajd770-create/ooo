import { Crown } from "lucide-react";

export default function Leaderboard({ players, currentPlayer }) {
  const withCells = [...players].map((p) => {
    return { ...p, cells: 0 };
  });
  // Compute from players array (already has wins). Cells count comes from grid, computed by parent if needed.
  const sorted = [...players].sort((a, b) => (b.wins || 0) - (a.wins || 0));
  return (
    <div className="card-dark p-4">
      <h3 className="text-xl font-bold mb-3 flex items-center gap-2"><Crown className="w-5 h-5 text-yellow-400" /> الترتيب</h3>
      <div className="space-y-2">
        {sorted.map((p, i) => (
          <div key={p.id} className={`p-2 rounded-lg flex items-center justify-between border ${p.eliminated ? "opacity-40 line-through" : ""} ${currentPlayer === p.id ? "ring-2 ring-cyan-400" : ""}`} style={{ borderColor: p.color + "77", background: p.color + "10" }} data-testid={`lb-${p.id}`}>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">{i + 1}</span>
              <span className="text-lg">{p.icon}</span>
              <div>
                <div className="font-bold text-sm" style={{ color: p.color }}>{p.name}</div>
                <div className="text-[10px] text-gray-500">{p.category_name}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-black text-lg">{p.wins || 0}</div>
              <div className="text-[10px] text-gray-500">انتصار</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
