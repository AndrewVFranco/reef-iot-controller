export function Badge({ variant = "default", children, className = "" }) {
  const variants = {
    default:  "bg-surface-600 text-gray-300",
    ok:       "bg-emerald-900/50 text-emerald-400 border border-emerald-800/50",
    warning:  "bg-amber-900/50 text-amber-400 border border-amber-800/50",
    fault:    "bg-red-900/50 text-red-400 border border-red-800/50",
    offline:  "bg-surface-600 text-gray-500",
    accent:   "bg-accent-muted text-accent-light border border-accent-dark/30",
    running:  "bg-cyan-900/50 text-cyan-400 border border-cyan-800/50",
  };

  return (
    <span
      className={[
        "status-pill",
        variants[variant] ?? variants.default,
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}
