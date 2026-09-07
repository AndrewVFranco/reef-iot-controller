export function Button({
  variant  = "primary",
  size     = "md",
  disabled = false,
  loading  = false,
  onClick,
  children,
  className = "",
  type = "button",
}) {
  const variants = {
    primary:   "bg-accent hover:bg-accent-light text-surface-900 font-semibold shadow-glow hover:shadow-glow",
    secondary: "bg-surface-700 hover:bg-surface-500 text-white border border-surface-600",
    danger:    "bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800/50",
    ghost:     "hover:bg-surface-700 text-gray-400 hover:text-white",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-lg",
    md: "px-4 py-2 text-sm rounded-xl",
    lg: "px-5 py-2.5 text-sm rounded-xl",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-2 transition-all duration-150",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        "active:scale-95",
        variants[variant] ?? variants.primary,
        sizes[size] ?? sizes.md,
        className,
      ].join(" ")}
    >
      {loading && (
        <svg
          className="animate-spin h-3.5 w-3.5 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12" cy="12" r="10"
            stroke="currentColor" strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
