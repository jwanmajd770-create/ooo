import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

export default function CustomQuestionForm({ code, hostToken }) {
  const [cats, setCats] = useState([]);
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", "", "", ""]);
  const [a, setA] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.categories().then((r) => setCats(r.categories));
  }, []);

  const submit = async () => {
    if (!cat || !q.trim() || opts.some((o) => !o.trim())) {
      toast.error("أكمل كل الحقول");
      return;
    }
    try {
      const r = await api.custom(code, hostToken, cat, q.trim(), opts.map((o) => o.trim()), a);
      setCount(r.total_custom);
      setQ(""); setOpts(["", "", "", ""]); setA(0);
      toast.success(`أضيف! المجموع: ${r.total_custom}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "فشل");
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} data-testid="btn-open-custom" className="text-xs px-3 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/30">
        <Plus className="inline w-3 h-3 ms-1" /> إضافة سؤال مخصص ({count})
      </button>
    );
  }

  return (
    <div className="card-dark p-4 mt-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold">✍️ سؤال مخصص من المقدم</h3>
        <button onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
      </div>
      <select data-testid="custom-cat" value={cat} onChange={(e) => setCat(e.target.value)} className="w-full p-2 mb-2 rounded bg-black/50 border border-white/10">
        <option value="">اختر الفئة</option>
        {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
      </select>
      <input data-testid="custom-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نص السؤال" className="w-full p-2 mb-2 rounded bg-black/50 border border-white/10" />
      {opts.map((o, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <input value={o} onChange={(e) => { const n = [...opts]; n[i] = e.target.value; setOpts(n); }} placeholder={`الخيار ${["أ","ب","ج","د"][i]}`} className="flex-1 p-2 rounded bg-black/50 border border-white/10" data-testid={`custom-opt-${i}`} />
          <button onClick={() => setA(i)} className={`px-3 rounded ${a === i ? "bg-green-500 text-black font-bold" : "bg-white/5"}`} data-testid={`custom-correct-${i}`}>{a === i ? "✓ صحيح" : "علّم"}</button>
        </div>
      ))}
      <button data-testid="btn-add-custom" onClick={submit} className="w-full p-2 rounded bg-purple-500 text-white font-bold hover:bg-purple-400">أضف السؤال</button>
      {count > 0 && <p className="text-xs text-gray-400 mt-2 text-center">تم إضافة {count} سؤال مخصص</p>}
    </div>
  );
}
