import { useEffect, useRef, useState } from "react";
import AgoraRTC from "agora-rtc-sdk-ng";
import { api } from "../lib/api";

const DEFAULT_VOLUME_POLL_INTERVAL_MS = 1000;

export function useVoiceChat({ roomId, playerId, token, isDuelActive, duelPlayers, isCurrentDuelPlayer, onError }) {
  const clientRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [volumeState, setVolumeState] = useState({});
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const shouldPublish = isDuelActive && isCurrentDuelPlayer;

  useEffect(() => {
    let alive = true;

    async function initVoice() {
      if (!roomId || !playerId) return;

      try {
        const tokenRes = await api.voiceToken(roomId, playerId);
        const rtcClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = rtcClient;

        rtcClient.on("user-published", async (user, mediaType) => {
          try {
            await rtcClient.subscribe(user, mediaType);
            if (mediaType === "audio") {
              const remoteAudioTrack = user.audioTrack;
              remoteAudioTrack?.play();
            }
          } catch (err) {
            console.warn("Agora subscribe failed", err);
          }
        });

        rtcClient.on("user-unpublished", (user) => {
          // nothing else needed; remote track cleanup is automatic
        });

        rtcClient.on("volume-indicator", (volumes) => {
          if (!alive) return;
          const active = {};
          volumes.forEach((item) => {
            if (item.level > 0) active[item.uid] = item.level;
          });
          setVolumeState(active);
        });

        await rtcClient.join(tokenRes.app_id, tokenRes.channel, tokenRes.token, playerId);
        setConnected(true);
        rtcClient.enableAudioVolumeIndicator(DEFAULT_VOLUME_POLL_INTERVAL_MS);

        if (shouldPublish) {
          const track = await AgoraRTC.createMicrophoneAudioTrack();
          localAudioTrackRef.current = track;
          await rtcClient.publish(track);
          setMicMuted(false);
        }
      } catch (err) {
        console.warn("Voice chat unavailable", err);
        setVoiceEnabled(false);
        onError?.(err?.message || "فشل الاتصال بالصوت");
      }
    }

    initVoice();

    return () => {
      alive = false;
      if (volumeTimer) {
        clearInterval(volumeTimer);
        volumeTimer = null;
      }
      const client = clientRef.current;
      const track = localAudioTrackRef.current;
      if (track) {
        try {
          track.stop();
          track.close();
        } catch (_) {}
      }
      if (client) {
        try {
          if (track) client.unpublish(track);
        } catch (_) {}
        try {
          client.leave();
        } catch (_) {}
      }
      clientRef.current = null;
      localAudioTrackRef.current = null;
      setConnected(false);
    };
  }, [roomId, playerId, shouldPublish, onError]);

  useEffect(() => {
    async function updatePublish() {
      const client = clientRef.current;
      if (!client) return;
      if (shouldPublish) {
        if (!localAudioTrackRef.current) {
          try {
            const track = await AgoraRTC.createMicrophoneAudioTrack();
            localAudioTrackRef.current = track;
            await client.publish(track);
            setMicMuted(false);
          } catch (err) {
            console.warn("Failed to publish microphone", err);
            setVoiceEnabled(false);
            onError?.(err?.message || "فشل في تفعيل الميكروفون");
          }
        }
      } else {
        if (localAudioTrackRef.current) {
          try {
            await client.unpublish(localAudioTrackRef.current);
          } catch (_) {}
          try {
            localAudioTrackRef.current.stop();
            localAudioTrackRef.current.close();
          } catch (_) {}
          localAudioTrackRef.current = null;
          setMicMuted(true);
        }
      }
    }
    updatePublish();
  }, [shouldPublish, onError]);

  const toggleMute = async () => {
    const track = localAudioTrackRef.current;
    if (!track) return;
    try {
      if (micMuted) {
        await track.setEnabled(true);
      } else {
        await track.setEnabled(false);
      }
      setMicMuted(!micMuted);
    } catch (err) {
      console.warn("Failed to toggle mute", err);
      onError?.(err?.message || "فشل في كتم الصوت");
    }
  };

  return {
    connected,
    voiceEnabled,
    micMuted,
    toggleMute,
    volumeState,
    localAudioTrack: localAudioTrackRef.current,
  };
}
