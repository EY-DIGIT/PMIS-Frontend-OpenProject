import React from 'react';
import { useStore } from './store';

export default function LoaderModal() {
  const { loader } = useStore();
  if (!loader) return null;
  return (
    <div className="pmis-modal pmis-loader-modal pmis-modal-open">
      <div className="pmis-modal-box pmis-modal-box-compact pmis-modal-center">
        <div className="pmis-loader-spinner" />
        <h3 className="pmis-loader-title">{loader.text}</h3>
        <div className="pmis-hint pmis-loader-sub">Please wait…</div>
      </div>
    </div>
  );
}
