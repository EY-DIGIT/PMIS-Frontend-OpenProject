import React, { useState, useRef } from 'react';
import { safeArray, formatDateTime } from './utils';

export default function CommentsPanel({ comments, editable, onPost }) {
  const [text, setText] = useState('');
  const fileInputRef = useRef(null);

  const handlePost = () => {
    const files = Array.from(fileInputRef.current?.files || []).map((f) => f.name);
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) {
      onPost?.({ error: 'Write a comment or attach a file first.' });
      return;
    }
    onPost?.({ text: trimmed, files });
    setText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const list = safeArray(comments);

  return (
    <div className="pmis-comments-panel">
      <div className="pmis-comments-title">💬 Comments & Attachments</div>
      {editable && (
        <div className="pmis-comment-composer">
          <div className="pmis-field">
            <textarea
              className="pmis-comment-textarea"
              placeholder="Write a comment..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="pmis-comment-upload-row">
            <div className="pmis-field">
              <label>Attachments</label>
              <input type="file" multiple ref={fileInputRef} />
            </div>
            <div>
              <button className="pmis-btn" type="button" onClick={handlePost}>Post Comment</button>
            </div>
          </div>
        </div>
      )}
      <div className="pmis-comment-list">
        {list.length === 0 ? (
          <div className="pmis-hint">No comments yet</div>
        ) : (
          list.map((item, i) => (
            <div className="pmis-comment-item" key={i}>
              <div className="pmis-comment-meta">
                {item.who || 'User'} · {formatDateTime(item.when)}
              </div>
              <div>{item.text || ''}</div>
              {safeArray(item.attachments).length > 0 && (
                <div className="pmis-comment-attachments">
                  {item.attachments.map((f, idx) => (
                    <span className="pmis-attachment-chip" key={idx}>
                      📎 {typeof f === 'string' ? f : f.name || ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
