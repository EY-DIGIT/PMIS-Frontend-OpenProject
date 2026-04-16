// ─── Comments Panel ───────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
import Field from "./Field";
const fmtDate = (d) => { if (!d || d === "-") return "-"; const p = String(d).split("-"); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d; };
const fmtDT = (iso) => { if (!iso) return "-"; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB"); };
const safeArr = (v) => Array.isArray(v) ? v : [];
export default function CommentsPanel({ comments, onAdd }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const fileRef = useRef();
  const post = () => {
    if (!text.trim() && files.length === 0) return;
    onAdd({ who: "Admin", when: new Date().toISOString(), text: text.trim(), attachments: files.map(f => f.name) });
    setText(""); setFiles([]); if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div className="comments-panel">
      <div className="comments-title">Comments</div>
      <div className="comment-composer">
        <Field label="Comment">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Write a comment…" />
        </Field>
        <div className="comment-upload-row">
          <Field label="Attachments">
            <input type="file" multiple ref={fileRef} onChange={e => setFiles(Array.from(e.target.files))} />
          </Field>
          <div style={{ paddingBottom: 4 }}>
            <Btn onClick={post}>Post Comment</Btn>
          </div>
        </div>
      </div>
      <div className="comment-list">
        {safeArr(comments).length === 0 ? <div className="hint">No comments yet</div> :
          safeArr(comments).map((c, i) => (
            <div className="comment-item" key={i}>
              <div className="comment-meta">{c.who} · {fmtDT(c.when)}</div>
              <div>{c.text}</div>
              {safeArr(c.attachments).map((a, j) => (
                <span className="attachment-chip" key={j}>📎 {a}</span>
              ))}
            </div>
          ))
        }
      </div>
    </div>
  );
}