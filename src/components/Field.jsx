import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
export default function Field({ label, required, children, full }) {
    return (
        <div className="field" style={full ? { gridColumn: "1/-1" } : {}}>
            <label>{label}{required && <span className="required"> *</span>}</label>
            {children}
        </div>
    );
}