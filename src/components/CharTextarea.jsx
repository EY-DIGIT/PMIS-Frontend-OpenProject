import { useState } from 'react';

export default function CharTextarea({
  value,
  onChange,
  disabled = false,
  maxLength = 5000,
  className = ''
}) {
  const [internal, setInternal] = useState(value ?? '');
  const current = value !== undefined ? value : internal;
  const remaining = maxLength - (current?.length || 0);

  function handleChange(e) {
    if (onChange) onChange(e.target.value);
    else setInternal(e.target.value);
  }

  return (
    <>
      <textarea
        className={className}
        maxLength={maxLength}
        value={current}
        disabled={disabled}
        onChange={handleChange}
      />
      <div className="uidai-pmis-char-count">{remaining} characters remaining</div>
    </>
  );
}
