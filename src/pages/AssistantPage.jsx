// ============================================================
// AssistantPage.jsx — "Aadhaar Genius" full-page chat assistant.
//
// Opened from the sidebar "Assistant" entry (route: /assistant).
// Single-column chat: an "Aadhaar Genius" branded top bar over a chat
// thread wired to the n8n chat webhook:
//
//   POST {WEBHOOK}  { action:"sendMessage", sessionId, chatInput }
//        → { output: "<assistant reply>" }
//
// One sessionId is generated per conversation so the webhook keeps
// context for the session.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiSend, FiX, FiUser, FiPaperclip, FiFile } from "react-icons/fi";
import Aadhaar from "../assets/Aadhaar.png";
import { getToken } from "../api/auth";

// Two n8n chat webhooks power Aadhaar Genius:
//   • project    → project-related information
//   • documents  → document / deliverable lookups
const PROJECT_WEBHOOK_URL =
  "http://10.1.131.199:5678/webhook/testNew";
const DOCUMENTS_WEBHOOK_URL =
  "http://10.1.131.199:5678/webhook/rag-sarvam";

// n8n instance id sent with each chat request (matches the working curl).
const N8N_INSTANCE_ID =
  "fccf52d42441dd9f26257393c3e31924e0849f14611c04622f87dac4d51ca27a";

const BRAND_GRADIENT = "linear-gradient(135deg, #173e77 0%, #1a8f99 100%)";

// Per-mode request config. Each mode builds its own fetch request:
//   • project   → JSON body ({ action, sessionId, chatInput } → { output })
//   • documents → RAG chat, multipart/form-data with an optional file upload
const MODES = {
  project: {
    key: "project",
    label: "Project Info",
    url: PROJECT_WEBHOOK_URL,
    placeholder: "Ask about UIDAI, SLAs, projects, vendors…",
    greeting: "Hello! I'm Aadhaar Genius. Ask me anything about projects, SLAs and vendors.",
    allowFile: false,
    // The project workflow authenticates as the logged-in user: it reads the
    // app session token both as the Bearer header and as the sessionId.
    buildRequest: (text, ids) => ({
      headers: {
        "Content-Type": "application/json",
        Accept: "*/*",
        "X-Instance-Id": N8N_INSTANCE_ID,
        Authorization: `Bearer ${ids.token}`,
      },
      body: JSON.stringify({ action: "sendMessage", sessionId: ids.token, chatInput: text }),
    }),
  },
  documents: {
    key: "documents",
    label: "Documents",
    url: DOCUMENTS_WEBHOOK_URL,
    placeholder: "Ask about a document, or attach a PDF to chat with it…",
    greeting: "Hi! Attach a document (PDF) and ask me anything about it — or just ask a question.",
    allowFile: true,
    // RAG chat — multipart/form-data with chatInput, sessionId (the app token)
    // and an optional file. Don't set Content-Type: the browser adds the
    // multipart boundary. Headers stay minimal to avoid a CORS preflight.
    buildRequest: (text, ids, file) => {
      const fd = new FormData();
      fd.append("chatInput", text);
      fd.append("sessionId", ids.token);
      if (file) fd.append("file", file);
      return { headers: { Accept: "*/*" }, body: fd };
    },
  },
};
const MODE_ORDER = ["project", "documents"];

function nowTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AssistantPage() {
  const navigate = useNavigate();

  // Which knowledge base the chat is talking to.
  const [mode, setMode] = useState("project");
  // One message thread per mode so switching preserves each conversation.
  const [threads, setThreads] = useState(() => ({
    project: [{ role: "bot", text: MODES.project.greeting, time: nowTime() }],
    documents: [{ role: "bot", text: MODES.documents.greeting, time: nowTime() }],
  }));
  const messages = threads[mode];
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Documents (RAG) mode lets the user attach a file to chat with.
  const [pendingFile, setPendingFile] = useState(null);
  const fileInputRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const allowFile = MODES[mode].allowFile;
  const canSend = (input.trim() || (allowFile && pendingFile)) && !sending;

  /* Keep the thread pinned to the newest message. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Append a message to a specific mode's thread (captured at send time so a
  // reply lands in the right conversation even if the user switches modes).
  const appendTo = (m, msg) =>
    setThreads((t) => ({ ...t, [m]: [...t[m], msg] }));

  const send = async () => {
    const text = input.trim();
    const activeMode = mode;
    const cfg = MODES[activeMode];
    const file = cfg.allowFile ? pendingFile : null;
    if ((!text && !file) || sending) return;

    appendTo(activeMode, { role: "user", text, file: file?.name, time: nowTime() });
    setInput("");
    if (cfg.allowFile) setPendingFile(null);
    setSending(true);

    try {
      const ids = { token: getToken() };
      const { headers, body } = cfg.buildRequest(text, ids, file);
      const res = await fetch(cfg.url, { method: "POST", headers, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rawText = await res.text();
      let reply;
      try {
        const data = JSON.parse(rawText);
        reply = (data && (data.output || data.text || data.message)) || rawText;
      } catch {
        reply = rawText;
      }
      reply = reply?.trim() || "Sorry, I didn't get a response.";
      appendTo(activeMode, { role: "bot", text: String(reply), time: nowTime() });
    } catch {
      appendTo(activeMode, {
        role: "bot",
        text: "Couldn't reach the assistant. Please check your connection and try again.",
        time: nowTime(),
        error: true,
      });
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /* ── Small building blocks ───────────────────────────────── */
  const BotAvatar = () => (
    <div
      style={{
        width: 38,
        height: 38,
        borderRadius: "50%",
        background: "#fff",
        border: "1px solid #e0e5ec",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <img src={Aadhaar} alt="" style={{ width: 26, height: 26, objectFit: "contain" }} />
    </div>
  );

  const UserAvatar = () => (
    <div
      style={{
        width: 38,
        height: 38,
        borderRadius: "50%",
        background: BRAND_GRADIENT,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <FiUser size={20} />
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 220px)",
        minHeight: 480,
        background: "#fff",
        border: "1px solid #e0e5ec",
        borderRadius: 14,
        overflow: "hidden",
        margin: "8px 0",
      }}
    >
      {/* ── Chat column ── */}
      <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid #eef1f5",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src={Aadhaar}
              alt="Aadhaar"
              style={{ width: 32, height: 32, objectFit: "contain" }}
            />
            <span style={{ fontSize: 18, fontWeight: 700, color: "#173e77" }}>
              Aadhaar Genius
            </span>
          </div>

          {/* Mode toggle — pick which knowledge base the chat talks to. */}
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "#eef1f5",
              padding: 4,
              borderRadius: 10,
              marginLeft: 18,
            }}
          >
            {MODE_ORDER.map((k) => {
              const on = mode === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setMode(k);
                    setPendingFile(null);
                    if (inputRef.current) inputRef.current.focus();
                  }}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    background: on ? "#fff" : "transparent",
                    color: on ? "#173e77" : "#6b7890",
                    boxShadow: on ? "0 1px 3px rgba(0,0,0,.12)" : "none",
                    transition: "all .15s ease",
                  }}
                >
                  {MODES[k].label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #d0d7e2",
              background: "#fff",
              color: "#444",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            <FiX size={16} /> Close
          </button>
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 28px",
            background: "#fbfcfe",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {/* TODAY divider */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                color: "#8a97ab",
                background: "#eef1f5",
                padding: "4px 14px",
                borderRadius: 999,
              }}
            >
              TODAY
            </span>
          </div>

          {messages.map((m, i) => {
            const isUser = m.role === "user";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: isUser ? "row-reverse" : "row",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                {isUser ? <UserAvatar /> : <BotAvatar />}
                <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7890",
                      fontWeight: 600,
                      textAlign: isUser ? "right" : "left",
                    }}
                  >
                    {isUser ? "You" : "Aadhaar Genius"} · {m.time}
                  </div>
                  <div
                    style={{
                      background: isUser
                        ? BRAND_GRADIENT
                        : m.error
                          ? "#fdecea"
                          : "#fff",
                      color: isUser ? "#fff" : m.error ? "#b3261e" : "#1f2a3d",
                      border: isUser ? "none" : "1px solid #e6eaf0",
                      borderRadius: 14,
                      padding: "12px 16px",
                      fontSize: 15,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      boxShadow: isUser ? "0 4px 14px rgba(23,62,119,0.2)" : "none",
                    }}
                  >
                    {m.file && (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: m.text ? 6 : 0,
                          padding: "5px 10px",
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          background: isUser ? "rgba(255,255,255,0.18)" : "#eef2f8",
                          color: isUser ? "#fff" : "#3a4a63",
                        }}
                      >
                        <FiFile size={14} /> {m.file}
                      </div>
                    )}
                    {m.text && <div>{m.text}</div>}
                  </div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <BotAvatar />
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e6eaf0",
                  borderRadius: 14,
                  padding: "12px 16px",
                  color: "#9aa6ba",
                  fontSize: 18,
                  letterSpacing: 2,
                }}
              >
                …
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #eef1f5" }}>
          {/* Attached-file chip (documents mode) */}
          {allowFile && pendingFile && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
                padding: "6px 10px",
                borderRadius: 10,
                background: "#eef2f8",
                border: "1px solid #dbe3ee",
                fontSize: 13,
                fontWeight: 600,
                color: "#3a4a63",
                maxWidth: "100%",
              }}
            >
              <FiFile size={14} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                {pendingFile.name}
              </span>
              <button
                type="button"
                aria-label="Remove file"
                onClick={() => {
                  setPendingFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6b7890", display: "flex" }}
              >
                <FiX size={15} />
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 10,
              background: "#f3f5f9",
              border: "1px solid #e1e7ef",
              borderRadius: 16,
              padding: "8px 10px 8px 12px",
            }}
          >
            {/* Attach file — documents (RAG) mode only */}
            {allowFile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  aria-label="Attach file"
                  title="Attach a document"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    border: "none",
                    flexShrink: 0,
                    cursor: sending ? "not-allowed" : "pointer",
                    color: pendingFile ? "#173e77" : "#6b7890",
                    background: pendingFile ? "#e4ecf7" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FiPaperclip size={18} />
                </button>
              </>
            )}

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={MODES[mode].placeholder}
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 15,
                fontFamily: "inherit",
                color: "#1f2a3d",
                maxHeight: 120,
                padding: "8px 0",
              }}
            />
            <button
              type="button"
              aria-label="Send message"
              onClick={send}
              disabled={!canSend}
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                border: "none",
                flexShrink: 0,
                cursor: !canSend ? "not-allowed" : "pointer",
                color: "#fff",
                background: !canSend ? "#9bb0cf" : BRAND_GRADIENT,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FiSend size={18} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}