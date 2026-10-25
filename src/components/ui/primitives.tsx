"use client";

/**
 * Shared UI primitives. Created by the lead orchestrator; Agent 1 owns visual
 * refinement. Props are a shared contract — extend, don't break them.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square icon-only button. Provide aria-label / title. */
  icon?: boolean;
  active?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-violet text-white hover:bg-violet-soft shadow-[0_0_0_1px_rgb(167_139_250/0.4),0_6px_20px_-6px_rgb(139_92_246/0.6)]",
  accent: "bg-cyan/12 text-cyan-soft ring-1 ring-cyan/30 hover:bg-cyan/20",
  secondary: "bg-surface-3 text-fg ring-1 ring-line hover:bg-surface-4 hover:ring-line-strong",
  ghost: "text-fg-muted hover:bg-surface-3 hover:text-fg",
  danger: "bg-danger/12 text-danger ring-1 ring-danger/30 hover:bg-danger/20",
};
const SIZES: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11px] gap-1 rounded-md",
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-lg",
};
const ICON_SIZES: Record<ButtonSize, string> = { xs: "h-6 w-6 rounded-md", sm: "h-7 w-7 rounded-md", md: "h-9 w-9 rounded-lg" };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", icon = false, active = false, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center font-medium transition-[background,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        icon ? ICON_SIZES[size] : SIZES[size],
        active && "bg-violet/18 text-violet-soft ring-1 ring-violet/40",
        className,
      )}
      {...rest}
    />
  );
});

/* ------------------------------------------------------------------ */
/* Slider                                                              */
/* ------------------------------------------------------------------ */

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Called when the user releases the slider. */
  onCommit?: (value: number) => void;
  unit?: string;
  hint?: string;
  disabled?: boolean;
  format?: (value: number) => string;
  /** Live modulation indicator 0..1 drawn under the track (optional). */
  className?: string;
}

function defaultFormat(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return value.toFixed(decimals);
}

export function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, unit, hint, disabled, format, className }: SliderProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const shown = format ? format(value) : defaultFormat(value, step);
  const commitDraft = () => {
    setEditing(false);
    const n = Number(draft);
    if (Number.isFinite(n)) {
      const v = Math.min(max, Math.max(min, n));
      onChange(v);
      onCommit?.(v);
    }
  };
  return (
    <div className={cx("group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5", className)} title={hint}>
      <label htmlFor={id} className="truncate text-[11px] text-fg-muted">
        {label}
      </label>
      {editing ? (
        <input
          autoFocus
          className="h-5 w-16 rounded bg-surface-3 px-1 text-right font-mono text-[11px] text-fg outline-none ring-1 ring-violet/50"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          className="h-5 rounded px-1 text-right font-mono text-[11px] tabular-nums text-fg hover:bg-surface-3"
          onClick={() => {
            setDraft(String(value));
            setEditing(true);
          }}
          aria-label={`Edit ${label} value`}
        >
          {shown}
          {unit ? <span className="ml-0.5 text-fg-faint">{unit}</span> : null}
        </button>
      )}
      <input
        id={id}
        type="range"
        className="vanta-range col-span-2 w-full"
        style={{ ["--fill" as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle                                                              */
/* ------------------------------------------------------------------ */

export interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  size?: "sm" | "md";
}

export function Toggle({ label, checked, onChange, disabled, hint, size = "sm" }: ToggleProps) {
  const track = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knob = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const shift = size === "sm" ? "translate-x-3" : "translate-x-4";
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 disabled:opacity-40",
        track,
        checked ? "bg-violet" : "bg-surface-4",
      )}
    >
      <span className={cx("rounded-full bg-white shadow transition-transform duration-150", knob, checked && shift)} />
    </button>
  );
  if (!label) return control;
  return (
    <div className="flex items-center justify-between gap-2" title={hint}>
      <span className="truncate text-[11px] text-fg-muted">{label}</span>
      {control}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

export interface SelectProps<T extends string> {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

export function Select<T extends string>({ label, value, options, onChange, disabled, className }: SelectProps<T>) {
  const id = useId();
  const select = (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx(
        "h-7 min-w-0 rounded-md bg-surface-3 px-2 text-xs text-fg ring-1 ring-line outline-none hover:ring-line-strong focus:ring-violet/60 disabled:opacity-40",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-surface-2">
          {o.label}
        </option>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2">
      <label htmlFor={id} className="truncate text-[11px] text-fg-muted">
        {label}
      </label>
      {select}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ColorInput                                                          */
/* ------------------------------------------------------------------ */

export interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ColorInput({ label, value, onChange, disabled }: ColorInputProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    // Re-sync the hex draft when the colour changes from outside (picker, undo, AI).
    setPrevValue(value);
    setText(value);
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-2">
      <label htmlFor={id} className="truncate text-[11px] text-fg-muted">
        {label}
      </label>
      <input id={id} type="color" className="vanta-color h-5 w-7" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <input
        aria-label={`${label} hex`}
        className="h-6 w-full rounded bg-surface-3 px-1.5 font-mono text-[11px] uppercase text-fg ring-1 ring-line outline-none focus:ring-violet/60"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
          else setText(value);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Popover                                                             */
/* ------------------------------------------------------------------ */

/** Closes on outside click / Escape. Returns [open, setOpen, containerRef]. */
export function useDismissable<T extends HTMLElement>(initial = false): [boolean, (open: boolean) => void, RefObject<T | null>] {
  const [open, setOpen] = useState(initial);
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return [open, setOpen, ref];
}

export interface PopoverProps {
  /** Render prop for the trigger; call toggle() on click. */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end" | "center";
  side?: "bottom" | "top";
  className?: string;
}

export function Popover({ trigger, children, align = "end", side = "bottom", className }: PopoverProps) {
  const [open, setOpen, ref] = useDismissable<HTMLDivElement>();
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open ? (
        <div
          role="dialog"
          className={cx(
            "absolute z-50 min-w-56 rounded-[var(--radius-panel)] bg-surface-2/95 p-2 shadow-[var(--shadow-pop)] backdrop-blur-xl",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
            align === "end" && "right-0",
            align === "start" && "left-0",
            align === "center" && "left-1/2 -translate-x-1/2",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

export function SectionHeader({ title, actions, className }: { title: string; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex h-8 items-center justify-between px-3", className)}>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">{title}</h3>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-3 px-1 font-mono text-[10px] text-fg-muted">{children}</kbd>;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "violet" | "cyan" | "warning" | "danger" | "success"; className?: string }) {
  const tones = {
    neutral: "bg-surface-3 text-fg-muted ring-line",
    violet: "bg-violet/12 text-violet-soft ring-violet/30",
    cyan: "bg-cyan/10 text-cyan-soft ring-cyan/25",
    warning: "bg-warning/10 text-warning ring-warning/25",
    danger: "bg-danger/10 text-danger ring-danger/25",
    success: "bg-success/10 text-success ring-success/25",
  };
  return <span className={cx("inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium ring-1", tones[tone], className)}>{children}</span>;
}

/** Small inline notice for errors / info. */
export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "danger" | "success"; children: ReactNode }) {
  const tones = {
    neutral: "border-line bg-surface-2 text-fg-muted",
    warning: "border-warning/25 bg-warning/5 text-warning",
    danger: "border-danger/25 bg-danger/5 text-danger",
    success: "border-success/25 bg-success/5 text-success",
  };
  return <div className={cx("rounded-md border px-2.5 py-2 text-[11px] leading-relaxed", tones[tone])}>{children}</div>;
}
