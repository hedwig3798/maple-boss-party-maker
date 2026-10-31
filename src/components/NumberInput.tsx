import { useEffect, useState } from 'react';

interface Props {
  value: number | undefined;
  /** 빈칸이면 undefined */
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  step?: number;
  className?: string;
  title?: string;
}

/** 입력 중인 텍스트("12." 등)를 유지하면서 유효한 숫자만 반영하는 입력칸 */
export function NumberInput({ value, onChange, placeholder, min, step, className, title }: Props) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? undefined : Number(text);
    if (parsed !== value) setText(value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      value={text}
      placeholder={placeholder}
      min={min}
      step={step ?? 'any'}
      title={title}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === '') onChange(undefined);
        else if (Number.isFinite(Number(t))) onChange(Number(t));
      }}
    />
  );
}
