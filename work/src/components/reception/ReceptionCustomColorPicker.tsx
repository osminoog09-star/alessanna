import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// ── colour math ────────────────────────────────────────────────────────────

function hsvToHex(h: number, s: number, v: number): string {
  s /= 100; v /= 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 100];
  let r = parseInt(m[1], 16) / 255;
  let g = parseInt(m[2], 16) / 255;
  let b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(v * 100)];
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0.5;
  const lin = (x: number) => { const u = x / 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(parseInt(m[1], 16)) + 0.7152 * lin(parseInt(m[2], 16)) + 0.0722 * lin(parseInt(m[3], 16));
}

// ── component ──────────────────────────────────────────────────────────────

type Props = {
  staffName: string;
  initialHex: string;
  onSave: (hex: string) => void;
  onCancel: () => void;
};

const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

export function ReceptionCustomColorPicker({ staffName, initialHex, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const [h, s0, v0] = hexToHsv(initialHex);
  const [hue, setHue] = useState(h);
  const [sat, setSat] = useState(s0);
  const [val, setVal] = useState(v0);
  const [hexInput, setHexInput] = useState(initialHex.toUpperCase());
  const pickerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  const currentHex = hsvToHex(hue, sat, val);
  const textColor = luminance(currentHex) > 0.35 ? "#3c4043" : "#ffffff";
  const initial = (staffName?.charAt(0) ?? "A").toUpperCase();

  // Keep hex input in sync with picker
  useEffect(() => {
    setHexInput(currentHex.toUpperCase());
  }, [currentHex]);

  // Escape → cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // ── pointer helpers ────────────────────────────────────────────────────

  function readPicker(e: React.PointerEvent | PointerEvent) {
    if (!pickerRef.current) return;
    const r = pickerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    setSat(Math.round(x * 100));
    setVal(Math.round((1 - y) * 100));
  }

  function readSlider(e: React.PointerEvent | PointerEvent) {
    if (!sliderRef.current) return;
    const r = sliderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHue(Math.round(x * 360));
  }

  function handleHexInput(raw: string) {
    setHexInput(raw);
    if (/^#[0-9a-f]{6}$/i.test(raw)) {
      const [nh, ns, nv] = hexToHsv(raw);
      setHue(nh); setSat(ns); setVal(nv);
    }
  }

  async function handleEyeDropper() {
    if (!hasEyeDropper) return;
    try {
      // @ts-ignore
      const { sRGBHex } = await new window.EyeDropper().open() as { sRGBHex: string };
      const expanded = sRGBHex.length === 4
        ? "#" + sRGBHex.slice(1).split("").map((c: string) => c + c).join("")
        : sRGBHex;
      if (/^#[0-9a-f]{6}$/i.test(expanded)) {
        const [nh, ns, nv] = hexToHsv(expanded);
        setHue(nh); setSat(ns); setVal(nv);
      }
    } catch { /* cancelled */ }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-[340px] rounded-2xl bg-white px-6 pb-5 pt-6 shadow-2xl">
        {/* Title */}
        <h2 className="mb-1 text-xl font-normal text-[#3c4043]">{t("reception.customColorTitle")}</h2>
        <p className="mb-5 text-sm leading-snug text-[#5f6368]">{t("reception.customColorSubtitle")}</p>

        <div className="mb-4 flex gap-3">
          {/* Preview + eyedropper */}
          <div className="flex flex-col items-center gap-2 pt-0.5">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full text-base font-medium select-none"
              style={{ backgroundColor: currentHex, color: textColor }}
            >
              {initial}
            </div>
            <button
              onClick={() => void handleEyeDropper()}
              disabled={!hasEyeDropper}
              title={t("reception.eyeDropper")}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#dadce0] text-[#5f6368] transition-colors hover:bg-[#f1f3f4] disabled:opacity-40"
            >
              {/* eyedropper icon */}
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M20.71 5.63l-2.34-2.34a1 1 0 00-1.41 0l-3.12 3.12-1.41-1.42-1.42 1.42 1.41 1.41-6.6 6.6A2 2 0 005 16v3h3a2 2 0 001.42-.59l6.6-6.6 1.41 1.42 1.42-1.42-1.42-1.41 3.12-3.12a1 1 0 000-1.65zM8 17H7v-1l6.6-6.58 1 1z"/>
              </svg>
            </button>
          </div>

          {/* 2D saturation-value picker */}
          <div
            ref={pickerRef}
            className="relative flex-1 cursor-crosshair select-none rounded"
            style={{
              height: 140,
              background: `linear-gradient(to right, #fff, hsl(${hue}, 100%, 50%))`,
            }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); readPicker(e); }}
            onPointerMove={(e) => { if (e.buttons) readPicker(e); }}
          >
            {/* black overlay top→bottom */}
            <div className="pointer-events-none absolute inset-0 rounded" style={{ background: "linear-gradient(to bottom,transparent,#000)" }} />
            {/* indicator */}
            <div
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
              style={{ left: `${sat}%`, top: `${100 - val}%`, boxShadow: "0 0 0 1.5px rgba(0,0,0,0.28)" }}
            />
          </div>
        </div>

        {/* Hue slider */}
        <div
          ref={sliderRef}
          className="relative mb-4 h-4 w-full cursor-pointer select-none rounded-full"
          style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); readSlider(e); }}
          onPointerMove={(e) => { if (e.buttons) readSlider(e); }}
        >
          <div
            className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{ left: `${(hue / 360) * 100}%`, backgroundColor: `hsl(${hue},100%,50%)`, boxShadow: "0 0 0 1.5px rgba(0,0,0,0.28)" }}
          />
        </div>

        {/* Hex input */}
        <div className="mb-6 rounded border border-[#dadce0] px-3 pb-2 pt-1.5 focus-within:border-[#1a73e8]">
          <div className="mb-0.5 text-xs text-[#5f6368]">{t("reception.hexCode")}</div>
          <input
            value={hexInput}
            onChange={(e) => handleHexInput(e.target.value)}
            className="w-full text-sm uppercase text-[#3c4043] outline-none"
            maxLength={7}
            spellCheck={false}
          />
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full px-5 py-2 text-sm font-medium text-[#1a73e8] transition-colors hover:bg-[#f1f3f4]"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => onSave(currentHex)}
            className="rounded-full bg-[#e8f0fe] px-5 py-2 text-sm font-medium text-[#1a73e8] transition-colors hover:bg-[#d2e3fc]"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
