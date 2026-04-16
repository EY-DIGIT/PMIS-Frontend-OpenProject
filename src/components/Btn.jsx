import { useState, useEffect, useRef, useCallback } from "react";
export default function Btn({ children, onClick, disabled, variant, style }) {
  const cls = ["btn", variant === "cancel" ? "cancel" : variant === "delete" ? "delete-btn" : variant === "small" ? "small-btn" : ""].filter(Boolean).join(" ");
  return <button className={cls} onClick={onClick} disabled={disabled} style={style}>{children}</button>;
}