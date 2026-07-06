import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { useGameState } from "../hooks/useGameState";
import { useVoiceChat } from "../hooks/useVoiceChat";
import { api } from "../lib/api";
import GameGrid from "../components/GameGrid";
import DuelModal from "../components/DuelModal";
import Leaderboard from "../components/Leaderboard";
import { toast } from "sonner";
import { Shield, Trophy, Mic, MicOff } from "lucide-react";
import { sfx } from "../lib/sfx";

export default function PlayerRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const raw = localStorage.getItem(`player_${code}`);
  const info = raw ? JSON.parse(raw) : null;
  const token = info?.token;
  const { state, error } = useGameState(code, token, 600);
  const [shieldMode, setShieldMode] = useState(false);
  const [eyeHint, setEyeHint] = useState(null);
  const [voiceError, setVoiceError] = useState(null);

  const me = state?.me;
  const isDuelActive = !!state?.duel && !state?.duel?.resolved;
  const duelPlayers = useMemo(
    () => [state?.duel?.attacker_id, state?.duel?.defender_id].filter(Boolean),
    [state?.duel?.attacker_id, state?.duel?.defender_id]
  );
  const isCurrentDuelPlayer = isDuelActive && duelPlayers.includes(me?.id);

  const { connected: voiceConnected, voiceEnabled, micMuted, toggleMute, volumeState } = useVoiceChat({
    roomId: code,
    playerId: me?.id,
    token,
    isDuelActive,
    duelPlayers,
    isCurrentDuelPlayer,
    onError: setVoiceError,
  });

  const speakingPlayerId = Object.keys(volumeState || {}).find((uid) => volumeState[uid] > 0);
  const speakingPlayer = state?.players?.find((p) => p.id === speakingPlayerId);

  useEffect(() => {
    if (!info) nav("/");
  }, [info, nav]);

  // clear eye hint when duel/question changes (new duel, or skip = new started_at)
  useEffect(() => {
    setEyeHint(null);
  }, [state?.duel?.started_at]);

  useEffect(() => {
    if (voiceError) {
      toast.error(voiceError);
    }
  }, [voiceError]);

  // restore eye hint from server (survives page refresh)
  useEffect(() => {
    const serverHint = state?.me?.eye_hint;
    if (serverHint !== undefined && serverHint !== null) setEyeHint(serverHint);
  }, [state?.me?.eye_hint]);

  // play win sound on victory
  useEffect(() => {
    if (state?.state === "finished") {
      sfx.resume();
      sfx.win();
    }
  }, [state?.state]);

  if (error) return <div className="p-6 text-red-400">{error}</div>;
  if (!state) return <div className="p-6 text-center">جاري التحميل...</div>;

  const myTurn = me && state.current_player === me.id && state.state === "active" && !state.duel;

  const canClickCell = (r, c) => {
    if (!myTurn) return false;
    // adjacent to any of my cells and not mine
    if (state.grid[r][c] === me.id) return false;
    for (let rr = 0; rr < 6; rr++) {
      for (let cc = 0; cc < 6; cc++) {
        if (state.grid[rr][cc] === me.id) {
          if (Math.abs(rr - r) + Math.abs(cc - c) === 1) return true;
        }
      }
    }
    return false;
  };

  const canShieldCell = (r, c) => shieldMode && state.grid[r][c] === me?.id;

  const cellClick = async (r, c) => {
    sfx.resume();
    if (shieldMode) {
      try {
        await api.powerup(code, token, "shield", r, c);
        sfx.powerup();
        toast.success("درع مفعّل!");
        setShieldMode(false);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "فشل");
      }
      return;
    }
    try {
      sfx.attack();
      const r2 = await api.attack(code, token, r, c);
      if (r2.blocked) toast.warning("درع منع الهجوم!");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "فشل الهجوم");
    }
  };

  const answer = async (idx) => {
    try { const r = await api.answer(code, token, idx); return r; } catch (e) { toast.error(e?.response?.data?.detail || "فشل"); throw e; }
  };

  const duelPass = async () => {
    try { const r = await api.duelPass(code, token); sfx.powerup(); return r; } catch (e) { toast.error(e?.response?.data?.detail || "فشل"); throw e; }
  };

  const shields = {};
  state.players.forEach((p) => { if (p.shield_on) shields[p.id] = p.shield_on; });

  const useSkip = async () => { try { await api.powerup(code, token, "skip"); sfx.powerup(); toast.success("سؤال جديد"); } catch (e) { toast.error(e?.response?.data?.detail); } };
  const useTime = async () => { try { await api.powerup(code, token, "time"); sfx.powerup(); toast.success("+5 ثواني"); } catch (e) { toast.error(e?.response?.data?.detail); } };
  const useEye = async () => { try { const r = await api.powerup(code, token, "eye"); sfx.powerup(); setEyeHint(r.eye_hint); toast.success("خيار خاطئ حُذف"); } catch (e) { toast.error(e?.response?.data?.detail); } };

  return (
    <div className="min-h-screen p-3 md:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{me?.color && me?.category_id}</span>
            <div className="text-right">
              <div className="text-xs text-gray-500">أنت</div>
              <div className="font-bold" style={{ color: me?.color }} data-testid="my-name">{me?.name}</div>
            </div>
          </div>
          <div className="text-center">
            {state.state === "lobby" && <span className="text-xs text-gray-400">بانتظار المقدم لبدء المعركة...</span>}
            {myTurn && <span className="px-3 py-1 rounded-full bg-cyan-400 text-black text-xs font-bold pulse-glow" data-testid="my-turn-badge">دورك! اختر خانة مجاورة</span>}
            {state.state === "active" && !myTurn && !state.duel && (
              <span className="text-xs text-gray-400">دور: {state.players.find((p) => p.id === state.current_player)?.name}</span>
            )}
            {state.sudden_death && <div className="mt-1 text-[10px] text-red-400 font-bold animate-pulse">⚡ موت مفاجئ</div>}
          </div>
          <div className="text-left text-xs text-gray-500">
            <div>الرمز: <span className="tabular">{code}</span></div>
            <div>الفوز: {me?.wins || 0}</div>
            {isCurrentDuelPlayer && state.state !== "finished" && (
              <button
                onClick={toggleMute}
                className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-xs text-white"
              >
                {micMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />} {micMuted ? "كتم" : "تشغيل الصوت"}
              </button>
            )}
          </div>
        </div>

        {state.state !== "lobby" && (
          <GameGrid
            grid={state.grid}
            players={state.players}
            currentPlayer={state.current_player}
            target={state.duel?.target}
            shields={shields}
            onCellClick={cellClick}
            canClickCell={shieldMode ? canShieldCell : canClickCell}
          />
        )}

        {state.state === "lobby" && (
          <div className="card-dark p-6 text-center">
            <h2 className="text-2xl font-bold mb-2">في انتظار البدء</h2>
            <p className="text-gray-400 mb-4">اللاعبون: {state.players.length}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {state.players.map((p) => (
                <span key={p.id} className="px-3 py-1 rounded-full text-sm" style={{ background: p.color + "20", color: p.color }}>
                  {p.icon} {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {me && !me.eliminated && state.state !== "lobby" && (
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            <button data-testid="pu-shield" disabled={!me.powerups.shield || shieldMode} onClick={() => setShieldMode(true)} className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-xs border border-white/10 disabled:opacity-30 flex items-center gap-1">
              <Shield className="w-3 h-3" /> درع خانة ({me.powerups.shield})
            </button>
            {shieldMode && <button onClick={() => setShieldMode(false)} className="px-3 py-2 rounded-lg bg-red-500/20 text-red-400 text-xs">إلغاء الدرع</button>}
          </div>
        )}

        {me?.eliminated && state.state !== "finished" && (
          <div className="mt-4 card-dark p-4 text-center">
            <p className="text-red-400 font-bold">💀 تم إقصاؤك! يمكنك متابعة المشاهدة.</p>
          </div>
        )}

        <div className="mt-4">
          <Leaderboard players={state.players} currentPlayer={state.current_player} />
        </div>

        <DuelModal
          duel={state.duel}
          meId={me?.id}
          players={state.players}
          onAnswer={answer}
          onPass={duelPass}
          onSkip={useSkip}
          onTime={useTime}
          onEye={useEye}
          myPowerups={me?.powerups}
          eyeHint={eyeHint}
          duelTimeoutMs={state.duel_timeout_ms}
        />

        {state.state === "finished" && (
          <div className="fixed inset-0 z-40 bg-black/95 flex flex-col items-center justify-center p-6">
            <Trophy className="w-24 h-24 text-yellow-400 mb-4" />
            <h1 className="text-5xl font-black neon-yellow mb-2">
              {state.winner === me?.id ? "👑 أنت الفائز!" : state.players.find((p) => p.id === state.winner)?.name + " فاز!"}
            </h1>
            <button onClick={() => nav("/")} className="mt-6 px-6 py-3 rounded-lg bg-cyan-400 text-black font-bold">العودة</button>
          </div>
        )}
      </div>
    </div>
  );
}
