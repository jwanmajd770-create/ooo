import { useEffect, useRef, useState } from "react";
import AgoraRTC from "agora-rtc-sdk-ng";
import { api } from "../lib/api";

const DEFAULT_VOLUME_POLL_INTERVAL_MS = 1000;

export function useVoiceChat({ roomId, playerId, isDuelActive, isCurrentDuelPlayer, onError }) {
  const clientRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [volumeState, setVolumeState] = useState({});
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const shouldPublish = !isDuelActive || isCurrentDuelPlayer;

  // الانضمام للقناة عند دخول الغرفة
  useEffect(() => {
    let alive = true;

    async function initVoice() {
      if (!roomId || !playerId) return;

      try {
        const tokenRes = await api.voiceToken(roomId, playerId);
        const joinParams = {
          appId: tokenRes.app_id,
          channel: tokenRes.channel,
          token: tokenRes.token,
          uid: tokenRes.uid,
        };

        const rtcClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = rtcClient;

        rtcClient.on("user-published", async (user, mediaType) => {
          try {
            await rtcClient.subscribe(user, mediaType);
            if (mediaType === "audio") {
              user.audioTrack?.play();
            }
          } catch (err) {
            console.warn("Agora subscribe failed", err);
          }
        });

        rtcClient.on("volume-indicator", (volumes) => {
          if (!alive) return;
          const active = {};
          volumes.forEach((item) => {
            if (item.level > 5) active[item.uid] = item.level;
          });
          setVolumeState(active);
        });

        rtcClient.enableAudioVolumeIndicator();

        await rtcClient.join(
          joinParams.appId,
          joinParams.channel,
          joinParams.token,
          joinParams.uid
        );

        if (!alive) {
          await rtcClient.leave();
          return;
        }

        setConnected(true);
      } catch (err) {
        console.warn("Voice chat unavailable", err);
        if (alive) {
          setVoiceEnabled(false);
          onError?.("الصوت غير متاح حالياً — اللعبة مستمرة بشكل طبيعي");
        }
      }
    }

    initVoice();

    return () => {
      alive = false;
      const client = clientRef.current;
      const track = localAudioTrackRef.current;
      if (track) {
        try {
          track.stop();
          track.close();
        } catch (e) {}
        localAudioTrackRef.current = null;
      }
      if (client) {
        try {
          client.leave();
        } catch (e) {}
        clientRef.current = null;
      }
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, playerId]);

  // نشر/إلغاء نشر الميكروفون حسب حالة المبارزة
  useEffect(() => {
    let cancelled = false;

    async function updatePublish() {
      const client = clientRef.current;
      if (!client || !connected || !voiceEnabled) return;

      try {
        if (shouldPublish && !localAudioTrackRef.current) {
          const track = await AgoraRTC.createMicrophoneAudioTrack();
          if (cancelled) {
            track.stop();
            track.close();
            return;
          }
          localAudioTrackRef.current = track;
          await client.publish([track]);
          track.setEnabled(true);
          setMicMuted(false);
        } else if (!shouldPublish && localAudioTrackRef.current) {
          const track = localAudioTrackRef.current;
          try {
            await client.unpublish([track]);
          } catch (e) {}
          track.stop();
          track.close();
          localAudioTrackRef.current = null;
          setMicMuted(true);
        }
      } catch (err) {
        console.warn("Voice publish/unpublish failed", err);
        if (!cancelled) {
          onError?.("تعذر تشغيل الميكروفون — تحقق من إذن المتصفح");
        }
      }
    }

    updatePublish();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPublish, connected, voiceEnabled]);

  // كتم/إلغاء كتم
  async function toggleMute() {
    const track = localAudioTrackRef.current;
    if (!track) return;
    const newMuted = !micMuted;
    try {
      await track.setEnabled(!newMuted);
      setMicMuted(newMuted);
    } catch (err) {
      console.warn("Toggle mute failed", err);
    }
  }

  return {
    connected,
    micMuted,
    volumeState,
    voiceEnabled,
    toggleMute,
    isPublishing: shouldPublish && !!localAudioTrackRef.current,
  };
}