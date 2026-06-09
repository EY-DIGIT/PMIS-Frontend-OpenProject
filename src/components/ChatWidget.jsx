// ============================================================
// ChatWidget.jsx — Floating assistant bubble (bottom-right).
//
// A small launcher button pinned to the bottom-right corner. Clicking
// it opens a chat panel on the right side of the screen. Messages are
// sent to the n8n chat webhook and the assistant's reply is rendered
// in the thread.
//
//   POST {WEBHOOK}  { action:"sendMessage", sessionId, chatInput }
//        → { output: "<assistant reply>" }
//
// sessionId is generated once per browser tab and reused for the whole
// conversation so the webhook can keep context.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { FiMessageCircle, FiX, FiSend } from "react-icons/fi";

const WEBHOOK_URL =
  "http://10.1.151.228:5678/webhook/595b77a5-75ed-4793-88db-0c2a10e04c4f/chat";

/* One session id per tab — kept in sessionStorage so it survives a
   component remount but starts fresh in a new tab. */
function getSessionId() {
  const KEY = "pmis_chat_session_id";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id =
      (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID()) ||
      `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

const GREETING = {
  role: "bot",
  text: "Hi! I'm the PMIS assistant. Ask me about projects, milestones or activities.",
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const sessionId = useRef(getSessionId());
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  /* Auto-scroll to the newest message whenever the thread grows or the
     panel opens. */
  useEffect(() => {
    if (!open) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, sending]);

  /* Focus the composer when the panel opens. */
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "*/*" },
        body: JSON.stringify({
          action: "sendMessage",
          sessionId: sessionId.current,
          chatInput: text,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const reply =
        (data && (data.output || data.text || data.message)) ||
        "Sorry, I didn't get a response.";
      setMessages((m) => [...m, { role: "bot", text: String(reply) }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text:
            "Couldn't reach the assistant. Please check your connection and try again.",
          error: true,
        },
      ]);
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

  return (
    <>
      {/* ── Launcher bubble ── */}
      <button
        type="button"
        aria-label={open ? "Close chat" : "Open chat assistant"}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          width: 58,
          height: 58,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          background: "#173e77",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 6px 20px rgba(23,62,119,0.4)",
          zIndex: 1000,
          transition: "transform 0.15s ease",
        }}
        onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.92)")}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {open ? <FiX size={26} /> : <FiMessageCircle size={26} />}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div
          role="dialog"
          aria-label="Chat assistant"
          style={{
            position: "fixed",
            right: 24,
            bottom: 94,
            width: "min(380px, calc(100vw - 32px))",
            height: "min(560px, calc(100vh - 140px))",
            background: "#fff",
            borderRadius: 14,
            boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 1000,
            border: "1px solid #e0e5ec",
          }}
        >
          {/* Header */}
          <div
            style={{
              background: "#173e77",
              color: "#fff",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <FiMessageCircle size={20} />
            <div style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ fontSize: 15 }}>PMIS Assistant</strong>
              <span style={{ fontSize: 12, opacity: 0.8 }}>
                {sending ? "Typing…" : "Online"}
              </span>
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                display: "flex",
              }}
            >
              <FiX size={20} />
            </button>
          </div>

          {/* Thread */}
          <div
            ref={threadRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 14,
              background: "#f5f7fa",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  background: m.role === "user"
                    ? "#173e77"
                    : m.error
                      ? "#fdecea"
                      : "#fff",
                  color: m.role === "user"
                    ? "#fff"
                    : m.error
                      ? "#b3261e"
                      : "#222",
                  border: m.role === "user" ? "none" : "1px solid #e0e5ec",
                  borderRadius: 12,
                  padding: "9px 12px",
                  fontSize: 14,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.text}
              </div>
            ))}
            {sending && (
              <div
                style={{
                  alignSelf: "flex-start",
                  background: "#fff",
                  border: "1px solid #e0e5ec",
                  borderRadius: 12,
                  padding: "9px 12px",
                  fontSize: 14,
                  color: "#888",
                }}
              >
                <span className="pmis-chat-typing">●●●</span>
              </div>
            )}
          </div>

          {/* Composer */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              padding: 10,
              borderTop: "1px solid #e0e5ec",
              background: "#fff",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message…"
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                border: "1px solid #d0d7e2",
                borderRadius: 10,
                padding: "9px 12px",
                fontSize: 14,
                fontFamily: "inherit",
                maxHeight: 100,
                outline: "none",
              }}
            />
            <button
              type="button"
              aria-label="Send message"
              onClick={send}
              disabled={!input.trim() || sending}
              style={{
                background: !input.trim() || sending ? "#9bb0cf" : "#173e77",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                width: 40,
                height: 40,
                cursor: !input.trim() || sending ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <FiSend size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
