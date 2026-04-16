import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
import Field from "./Field";
function phrasePool() { return ["quiet blue river bends", "silver dawn warms hills", "steady hands build trust", "gentle winds move forward", "bright paths stay clear", "calm lights guide work", "simple rules keep order", "solid plans hold firm"]; }

export default function DeleteProjectModal({ project, onConfirm, onClose }) {
  const phrase = useRef(phrasePool()[Math.floor(Math.random() * 8)]).current;
  const [val, setVal] = useState("");
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>Delete Project</h3>
        <div className="delete-warning">This action cannot be undone</div>
        <div className="phrase-box">{phrase}</div>
        <Field label="Type the phrase above">
          <input value={val} onChange={e => setVal(e.target.value)} onPaste={e => e.preventDefault()} autoComplete="off" spellCheck="false" />
        </Field>
        <div className="modal-actions">
          <Btn variant="delete" disabled={val !== phrase} onClick={onConfirm}>Delete Project</Btn>
          <Btn variant="cancel" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}