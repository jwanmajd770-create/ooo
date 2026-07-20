import AgoraRTC from "agora-rtc-sdk-ng";
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
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

  const [isTalking, setIsTalking] = useState(false);
  const [agoraClient, setAgoraClient] = useState(null);
  const [agoraTrack, setAgoraTrack] = useState(null);
  const [mutedPlayers, setMutedPlayers] = useState({});
  const [selectedTournamentPlayers, setSelectedTournamentPlayers] = useState([]);
  const kickPlayer = async (playerId, playerName) => {
    if (!window.confirm(`طرد اللاعب "${playerName}" من الغرفة؟`)) return;
    try {
      await api.kick(code, hostToken, playerId);
      toast.success(`تم طرد ${playerName}`);
    } catch { toast.error("فشل الطرد"); }
  };

  const toggleMute = async (playerId, playerName) => {
    const nowMuted = !mutedPlayers[playerId];
    try {
      await api.mute(code, hostToken, playerId, nowMuted);
      setMutedPlayers(prev => ({ ...prev, [playerId]: nowMuted }));
      toast.success(nowMuted ? `تم كتم ${playerName}` : `تم فك كتم ${playerName}`);
    } catch { toast.error("فشل الكتم"); }
  };

  const toggleTalk = async () => {
    if (!isTalking) {
      try {
        const tokenRes = await api.voiceToken(code, `host-${code}`);
        if (tokenRes.error || !tokenRes.token || !tokenRes.app_id) {
          alert("خطأ في خادم الصوت");
          return;
        }
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "audio" && user.audioTrack) user.audioTrack.play();
        });
        client.on("user-unpublished", (user, mediaType) => {
          if (mediaType === "audio" && user.audioTrack) user.audioTrack.stop();
        });
        await client.join(tokenRes.app_id, code, tokenRes.token, tokenRes.uid);
        const track = await AgoraRTC.createMicrophoneAudioTrack();
        await client.publish([track]);
        setAgoraClient(client);
        setAgoraTrack(track);
        setIsTalking(true);
      } catch (err) {
        console.error("Host mic error:", err);
        alert("تأكد من السماح بالمايكروفون");
      }
    } else {
      if (agoraTrack) agoraTrack.stop();
      if (agoraClient) await agoraClient.leave();
      setIsTalking(false);
      setAgoraClient(null);
      setAgoraTrack(null);
    }
  };

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

  const startTournamentDuel = async (player1Id, player2Id) => {
    try {
      await api.startTournamentDuel(code, hostToken, player1Id, player2Id);
      setSelectedTournamentPlayers([]);
      toast.success("بدأت مبارزة مباشرة");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "فشل بدء المبارزة");
    }
  };

  const toggleTournamentSelection = (playerId) => {
    setSelectedTournamentPlayers((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId);
      }
      if (prev.length === 1) {
        const nextPair = [prev[0], playerId];
        if (nextPair[0] !== nextPair[1]) {
          void startTournamentDuel(nextPair[0], nextPair[1]);
          return [];
        }
        return [playerId];
      }
      return [playerId];
    });
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
            <button onClick={toggleTalk} className={`px-3 py-2 rounded-lg text-xs font-bold ${isTalking ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-green-500/20 text-green-400 hover:bg-green-500/30"}`}>
              {isTalking ? "🔴 إيقاف" : "🎙️ تحدث"}
            </button>
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
                <div key={p.id} className="p-3 rounded-lg border-2" style={{ borderColor: p.color, background: p.color + "15" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{p.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">{p.name}</div>
                      <div className="text-xs opacity-70">{p.category_name}</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleMute(p.id, p.name)}
                      className={`flex-1 text-xs py-1 rounded transition-all ${mutedPlayers[p.id] ? 'bg-yellow-400 text-black' : 'bg-white/10 hover:bg-white/20'}`}
                      title={mutedPlayers[p.id] ? "فك الكتم" : "كتم الصوت"}
                    >{mutedPlayers[p.id] ? "🔈 مكتوم" : "🔇 كتم"}</button>
                    <button
                      onClick={() => kickPlayer(p.id, p.name)}
                      className="flex-1 text-xs py-1 rounded bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-all"
                      title="طرد من الغرفة"
                    >❌ طرد</button>
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
            <div className="flex flex-col gap-3">
              <Leaderboard players={state.players} currentPlayer={state.current_player} />
              {state.state === "active" && (!state.duel || state.duel.resolved) && state.players.filter((p) => !p.eliminated).length >= 2 && (
                <div className="card-dark p-3">
                  <div className="text-xs text-gray-400 mb-2 font-bold">مبارزات مباشرة</div>
                  <p className="text-sm text-gray-400 mb-3">اختر لاعبين اثنين لبدء مبارزة مباشرة. الخاسر يُقصى والفائز يبقى.</p>
                  <div className="grid grid-cols-1 gap-2">
                    {state.players.map((p) => {
                      const selected = selectedTournamentPlayers.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => toggleTournamentSelection(p.id)}
                          disabled={p.eliminated}
                          className={`rounded-lg border px-3 py-2 text-right text-sm transition-all ${selected ? "border-cyan-400 bg-cyan-500/20" : "border-white/10 bg-white/5 hover:bg-white/10"} ${p.eliminated ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{p.name}</span>
                            <span className="text-xs text-gray-400">{p.eliminated ? "مُقصى" : "مُتاح"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="card-dark p-3">
                <div className="text-xs text-gray-400 mb-2 font-bold">إدارة اللاعبين</div>
                {state.players.filter(p => !p.is_bot).map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{p.icon}</span>
                      <span className="text-sm truncate">{p.name}</span>
                    </div>
                    <button
                      onClick={() => kickPlayer(p.id, p.name)}
                      className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/40 text-red-400 whitespace-nowrap"
                    >❌ طرد</button>
                  </div>
                ))}
              </div>
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
