type ToggleSwitchProps = {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  /** sm: компактно в таблицах */
  size?: "sm" | "md";
  id?: string;
  "aria-label"?: string;
};

export function ToggleSwitch({
  checked,
  onCheckedChange,
  disabled,
  size = "md",
  id,
  "aria-label": ariaLabel,
}: ToggleSwitchProps) {
  const track = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const thumb = size === "sm" ? "h-4 w-4" : "h-[1.125rem] w-[1.125rem]";
  const thumbOn = "translate-x-[1.125rem]";

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onCheckedChange(!checked);
      }}
      className={[
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0",
        track,
        checked ? "border-emerald-600/50 bg-emerald-600" : "border-zinc-600 bg-zinc-700",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "pointer-events-none inline-block rounded-full bg-white transition-transform duration-200 ease-out",
          thumb,
          checked ? thumbOn : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
