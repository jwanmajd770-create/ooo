import React from "react";

// Renders a 6x6 grid of cells with owner colors.
// props: grid (2D array of player_id or null), players (list), onCellClick, canClickCell(r,c), highlightAdjacent (id), targetShields ({pid: [r,c]})
export default function GameGrid({ grid, players, onCellClick, canClickCell, currentPlayer, target, shields, sudden }) {
  const playerMap = Object.fromEntries((players || []).map((p) => [p.id, p]));
  const size = grid?.length || 6;
  return (
    <div className="grid grid-cols-6 gap-1 md:gap-2 w-full aspect-square p-2 bg-[#0F0F15] rounded-xl border border-white/5 max-w-[560px] mx-auto">
      {Array.from({ length: size }, (_, r) =>
        Array.from({ length: size }, (_, c) => {
          const ownerId = grid[r][c];
          const owner = ownerId ? playerMap[ownerId] : null;
          const clickable = onCellClick && canClickCell && canClickCell(r, c);
          const isTarget = target && target[0] === r && target[1] === c;
          const isCurrent = currentPlayer && owner && owner.id === currentPlayer;
          const isShielded = shields && Object.values(shields).some((s) => s && s[0] === r && s[1] === c);
          const style = owner
            ? {
                background: owner.color + "22",
                borderColor: owner.color,
                boxShadow: `0 0 12px ${owner.color}55`,
                color: owner.color,
              }
            : {};
          return (
            <button
              key={`${r}-${c}`}
              data-testid={`cell-${r}-${c}`}
              disabled={!clickable}
              onClick={() => clickable && onCellClick(r, c)}
              className={`aspect-square rounded-md md:rounded-lg flex items-center justify-center text-xs md:text-sm font-bold transition-all relative overflow-hidden border-2 ${
                owner ? "" : "bg-[#1A1A24] text-[#52525B] border-white/5"
              } ${clickable ? "cursor-pointer hover:brightness-125 hover:scale-105" : "cursor-default"} ${isCurrent ? "pulse-glow" : ""} ${isTarget ? "cell-invaded" : ""}`}
              style={style}
            >
              {owner ? <span className="text-lg md:text-2xl">{owner.icon}</span> : <span>·</span>}
              {isShielded && <span className="absolute top-0.5 right-0.5 text-[10px]">🛡️</span>}
            </button>
          );
        })
      )}
    </div>
  );
}
