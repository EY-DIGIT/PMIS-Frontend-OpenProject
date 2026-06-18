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
import { FiSend, FiX, FiUser } from "react-icons/fi";
import Aadhaar from "../assets/Aadhaar.png";
import { getToken } from "../api/auth";

const WEBHOOK_URL =
  "http://10.1.151.228:5678/webhook/aadhar";

// n8n instance id sent with each chat request (matches the working curl).
const N8N_INSTANCE_ID =
  "fccf52d42441dd9f26257393c3e31924e0849f14611c04622f87dac4d51ca27a";

const BRAND_GRADIENT = "linear-gradient(135deg, #173e77 0%, #1a8f99 100%)";

const GREETING = {
  role: "bot",
  text: "Hello! I'm Aadhaar Genius, your AI assistant. How can I help you today?",
};

function newSessionId() {
  return (
    (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID()) ||
    `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  );
}

function nowTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AssistantPage() {
  const navigate = useNavigate();

  const [messages, setMessages] = useState(() => [
    { ...GREETING, time: nowTime() },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const sessionId = useRef(newSessionId());
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  /* Keep the thread pinned to the newest message. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setMessages((m) => [...m, { role: "user", text, time: nowTime() }]);
    setInput("");
    setSending(true);

    try {
      // Use the app's current session token (same one every other
      // authorized request carries) so the webhook authenticates as the
      // logged-in user instead of a stale hardcoded token.
      const token = getToken();
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
          "X-Instance-Id": N8N_INSTANCE_ID,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "sendMessage",
          // Forward the session token in the body too so the workflow can
          // read it there (the browser can't forward it as a cookie
          // cross-origin).
          sessionId: token,
          chatInput: text,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      const reply =
        (data && (data.output || data.text || data.message)) ||
        "Sorry, I didn't get a response.";
      setMessages((m) => [
        ...m,
        { role: "bot", text: String(reply), time: nowTime() },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text:
            "Couldn't reach the assistant. Please check your connection and try again.",
          time: nowTime(),
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
                    {m.text}
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
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 10,
              background: "#f3f5f9",
              border: "1px solid #e1e7ef",
              borderRadius: 16,
              padding: "8px 10px 8px 18px",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask Aadhaar Genius anything about UIDAI, SLAs, projects, vendors…"
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
              disabled={!input.trim() || sending}
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                border: "none",
                flexShrink: 0,
                cursor: !input.trim() || sending ? "not-allowed" : "pointer",
                color: "#fff",
                background: !input.trim() || sending ? "#9bb0cf" : BRAND_GRADIENT,
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