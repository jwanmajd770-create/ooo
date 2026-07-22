import { useEffect, useRef, useState } from "react";

// صفحة تشخيص Web Speech API — تُظهر جميع الأحداث (start/result/error/end)
// لتحديد سبب فشل onresult في Chrome (network / language / permissions)
export default function VoiceTest() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [lang, setLang] = useState("ar-SA");
  const [log, setLog] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const listeningRef = useRef(false);

  const addLog = (msg) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLog((prev) => [...prev.slice(-30), `[${ts}] ${msg}`]);
    console.log("VoiceTest:", msg);
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("SpeechRecognition غير مدعوم في هذا المتصفح — استخدم Chrome أو Edge");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      addLog(`onstart (lang=${recognition.lang})`);
      setStatus("Listening 🎤");
      setError("");
      setIsListening(true);
      listeningRef.current = true;
    };

    recognition.onaudiostart = () => addLog("onaudiostart");
    recognition.onsoundstart = () => addLog("onsoundstart");
    recognition.onspeechstart = () => addLog("onspeechstart");
    recognition.onspeechend = () => addLog("onspeechend");
    recognition.onsoundend = () => addLog("onsoundend");
    recognition.onaudioend = () => addLog("onaudioend");
    recognition.onnomatch = () => addLog("onnomatch");

    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      const transcript = results.map((r) => r[0]?.transcript || "").join(" ").trim();
      const isFinal = results[results.length - 1]?.isFinal;
      addLog(`onresult (final=${isFinal}): "${transcript}"`);
      setText(transcript);
      setStatus(isFinal ? "Result ✅" : "Interim...");
    };

    recognition.onerror = (e) => {
      addLog(`onerror: ${e?.error} — ${e?.message || "(no message)"}`);
      setStatus("Error ❌");
      setError(e?.error || "unknown");
      setIsListening(false);
      listeningRef.current = false;
    };

    recognition.onend = () => {
      addLog("onend");
      setStatus("Ended");
      setIsListening(false);
      listeningRef.current = false;
    };

    recognitionRef.current = recognition;
    return () => {
      try { recognition.stop(); } catch (_) {}
    };
  }, [lang]);

  const handleStart = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listeningRef.current) {
      addLog("start ignored — already listening");
      return;
    }
    setText("");
    setLog([]);
    try {
      recognition.start();
    } catch (e) {
      addLog(`start() threw: ${e?.name} ${e?.message}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start gap-4 p-6 text-center" dir="rtl">
      <h1 className="text-2xl font-bold mt-4">تشخيص التعرّف على الصوت</h1>

      <div className="flex items-center gap-3">
        <label className="text-sm">اللغة:</label>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          disabled={isListening}
          className="rounded-lg bg-white/10 px-3 py-2 text-sm border border-white/20"
        >
          <option value="ar-SA">ar-SA (السعودية)</option>
          <option value="ar-EG">ar-EG (مصر)</option>
          <option value="ar-AE">ar-AE (الإمارات)</option>
          <option value="ar">ar (عام)</option>
          <option value="en-US">en-US (تجربة إنجليزي)</option>
        </select>
      </div>

      <button
        onClick={handleStart}
        disabled={isListening}
        className="rounded-full bg-cyan-500 px-8 py-5 text-4xl disabled:opacity-40"
      >
        🎤
      </button>

      <div className="text-lg">الحالة: <span className="font-bold">{status}</span></div>
      {error ? <div className="text-red-400">الخطأ: {error}</div> : null}

      <div className="max-w-xl w-full rounded-xl border border-white/10 bg-white/5 p-4 text-xl min-h-[60px]">
        {text || "..."}
      </div>

      <div className="max-w-2xl w-full text-left" dir="ltr">
        <div className="text-xs text-gray-400 mb-1">سجلّ الأحداث (Event Log):</div>
        <div className="rounded-lg bg-black/50 border border-white/10 p-3 font-mono text-xs text-cyan-200 max-h-64 overflow-auto">
          {log.length === 0 ? <div className="text-gray-500">— لا شيء بعد —</div> : log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>

      <div className="max-w-xl text-xs text-gray-400 leading-relaxed mt-4">
        <p><strong>تشخيص المشكلة "onstart ← onend بدون نتيجة":</strong></p>
        <ul className="list-disc pr-6 mt-2 space-y-1 text-right">
          <li>إذا رأيت <code>onerror: network</code> → خدمة Google Speech محجوبة أو الشبكة لا تصلها</li>
          <li>إذا رأيت <code>onerror: no-speech</code> → المايكروفون لا يلتقط صوتك بوضوح</li>
          <li>إذا رأيت <code>onerror: language-not-supported</code> → جرّب <code>ar-EG</code> أو <code>ar</code></li>
          <li>إذا لم يظهر أي <code>onerror</code> ولا <code>onresult</code> → مشكلة في خدمة Speech (VPN/جدار ناري)</li>
          <li>جرّب <code>en-US</code> — لو اشتغل معه فالمشكلة في دعم اللغة العربية عند خدمة Chrome</li>
        </ul>
      </div>
    </div>
  );
}
