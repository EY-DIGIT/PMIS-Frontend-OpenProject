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
import { setPageContext } from "../utils/pageContext";

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

/* ── Markdown rendering for assistant replies ─────────────────
   The model answers in markdown ("There are **43 users**", "- item",
   "1. item"). We render a safe subset — bold, italic, inline code,
   links, headings, lists and fenced code — as React elements, so no
   HTML from the webhook is ever injected into the page.
────────────────────────────────────────────────────────────── */
const CODE_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// **bold** / __bold__ / *italic* / _italic_ / `code` / [text](url)
const INLINE_PATTERN =
  "\\*\\*[^*]+\\*\\*|__[^_]+__|\\*[^*\\n]+\\*|_[^_\\n]+_|`[^`\\n]+`|\\[[^\\]]+\\]\\([^)\\s]+\\)";

function renderInline(text, keyPrefix) {
  // A fresh regex per call: renderInline recurses, so a shared one's
  // lastIndex would be clobbered mid-scan.
  const re = new RegExp(INLINE_PATTERN, "g");
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}:${m.index}`;
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key}
          style={{
            background: "#eef1f5",
            borderRadius: 4,
            padding: "1px 5px",
            fontSize: "0.92em",
            fontFamily: CODE_FONT,
          }}
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const cut = tok.indexOf("](");
      out.push(
        <a
          key={key}
          href={tok.slice(cut + 2, -1)}
          target="_blank"
          rel="noreferrer"
          style={{ color: "inherit", textDecoration: "underline" }}
        >
          {renderInline(tok.slice(1, cut), key)}
        </a>
      );
    } else {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const FENCE_RE = /^\s*```/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;

// Pipe tables: a row of "| a | b |" whose NEXT line is a "|---|---|"
// separator. Both lines are required — a lone sentence containing a pipe
// isn't a table.
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const isTableRow = (l) => typeof l === "string" && l.includes("|");
const isTableStart = (ls, n) =>
  isTableRow(ls[n]) && n + 1 < ls.length && TABLE_SEP_RE.test(ls[n + 1]);

// "| a | b |" → ["a", "b"] (the outer pipes leave empty edge cells).
const splitRow = (row) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const TABLE_CELL = {
  padding: "7px 10px",
  border: "1px solid #e6eaf0",
  textAlign: "left",
  verticalAlign: "top",
  // Cap the wide free-text columns (descriptions) so they wrap instead of
  // stretching the table across the screen.
  maxWidth: 360,
};

function Markdown({ text }) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // ``` fenced code ```
    if (FENCE_RE.test(line)) {
      i += 1;
      const body = [];
      while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++]);
      i += 1; // closing fence (or end of text)
      blocks.push(
        <pre
          key={key}
          style={{
            margin: 0,
            padding: "10px 12px",
            background: "#f3f5f9",
            border: "1px solid #e1e7ef",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: CODE_FONT,
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {body.join("\n")}
        </pre>
      );
      continue;
    }

    // # Heading
    const heading = line.match(HEADING_RE);
    if (heading) {
      i += 1;
      blocks.push(
        <div
          key={key}
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: heading[1].length <= 2 ? 16 : 15,
          }}
        >
          {renderInline(heading[2], `h${key}`)}
        </div>
      );
      continue;
    }

    // - bullet list
    if (BULLET_RE.test(line)) {
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i]))
        items.push(lines[i++].match(BULLET_RE)[1]);
      blocks.push(
        <ul key={key} style={{ margin: 0, paddingLeft: 22 }}>
          {items.map((it, n) => (
            <li key={n}>{renderInline(it, `u${key}-${n}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // 1. numbered list
    if (ORDERED_RE.test(line)) {
      const start = Number(line.match(ORDERED_RE)[1]) || 1;
      const items = [];
      while (i < lines.length && ORDERED_RE.test(lines[i]))
        items.push(lines[i++].match(ORDERED_RE)[2]);
      blocks.push(
        <ol key={key} start={start} style={{ margin: 0, paddingLeft: 22 }}>
          {items.map((it, n) => (
            <li key={n}>{renderInline(it, `o${key}-${n}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // | pipe | table |
    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      i += 2; // header row + separator row
      const rows = [];
      while (i < lines.length && lines[i].trim() && isTableRow(lines[i]))
        rows.push(splitRow(lines[i++]));
      blocks.push(
        // Wide tables (UUID + description columns) scroll inside the bubble
        // rather than stretching it.
        <div key={key} style={{ overflowX: "auto", maxWidth: "100%" }}>
          <table
            style={{
              borderCollapse: "collapse",
              fontSize: 13,
              // Size to the content and scroll, rather than squeezing every
              // column to fit the bubble. wordBreak cancels the bubble's
              // break-word, which otherwise splits headings mid-word.
              width: "max-content",
              wordBreak: "normal",
              overflowWrap: "break-word",
            }}
          >
            <thead>
              <tr>
                {header.map((h, n) => (
                  <th
                    key={n}
                    style={{
                      ...TABLE_CELL,
                      background: "#f3f5f9",
                      fontWeight: 700,
                      // Keep "Planned Start" on one line.
                      whiteSpace: "nowrap",
                      maxWidth: "none",
                    }}
                  >
                    {renderInline(h, `th${key}-${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rn) => (
                <tr key={rn}>
                  {/* Walk the header so ragged rows stay aligned. */}
                  {header.map((_, cn) => (
                    <td key={cn} style={TABLE_CELL}>
                      {renderInline(r[cn] ?? "", `td${key}-${rn}-${cn}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Plain paragraph — consecutive lines until a blank line or a new block.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !FENCE_RE.test(lines[i]) &&
      !HEADING_RE.test(lines[i]) &&
      !BULLET_RE.test(lines[i]) &&
      !ORDERED_RE.test(lines[i]) &&
      !isTableStart(lines, i)
    )
      para.push(lines[i++]);
    blocks.push(
      <div key={key} style={{ margin: 0, whiteSpace: "pre-wrap" }}>
        {renderInline(para.join("\n"), `p${key}`)}
      </div>
    );
  }

  return (
    // minWidth:0 lets the scrollable table child shrink instead of forcing
    // the whole bubble wider than the thread.
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {blocks}
    </div>
  );
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

  /* Publish the open tab so the global breadcrumb can render
     "Home › Aadhaar Genius › Project Info / Documents". Cleared on
     unmount so other routes don't inherit it. */
  useEffect(() => {
    setPageContext({ assistantTab: MODES[mode].label });
    return () => setPageContext({ assistantTab: "" });
  }, [mode]);

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
            // Replies that carry a table get a wider bubble — milestone dumps
            // are unreadable squeezed into the usual 72%.
            const wide = !isUser && !m.error && /\n\s*\|?[\s:|-]*-[\s:|-]*\|/.test(m.text || "");
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
                <div
                  style={{
                    maxWidth: wide ? "92%" : "72%",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
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
                    {m.text &&
                      (isUser || m.error ? (
                        <div>{m.text}</div>
                      ) : (
                        <Markdown text={m.text} />
                      ))}
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