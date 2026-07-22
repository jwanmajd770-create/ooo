import { useEffect, useRef, useState } from "react";

export default function VoiceTest() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return setError("SpeechRecognition not supported");
    const recognition = new SpeechRecognition();
    recognition.lang = "ar-SA";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { console.log("onstart"); setStatus("Listening"); setError(""); };
    recognition.onresult = (event) => { const transcript = Array.from(event.results).map((r) => r[0]?.transcript || "").join(" ").trim(); console.log("onresult", transcript); setText(transcript); setStatus("Result received"); };
    recognition.onerror = (e) => { console.log("onerror", e?.error); setStatus("Error"); setError(e?.error || "unknown"); };
    recognition.onend = () => { console.log("onend"); setStatus("Ended"); };
    recognitionRef.current = recognition;
    return () => recognition.stop?.();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center" dir="rtl">
      <button onClick={() => recognitionRef.current?.start()} className="rounded-full bg-cyan-500 px-8 py-5 text-4xl">🎤</button>
      <div className="text-lg">الحالة: {status}</div>
      {error ? <div className="text-red-400">الخطأ: {error}</div> : null}
      <div className="max-w-xl rounded-xl border border-white/10 bg-white/5 p-4 text-xl">{text || "..."}</div>
    </div>
  );
}
