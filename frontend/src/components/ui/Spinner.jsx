export function Spinner({ size = "md", className = "" }) {
  const sizes = {
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-2",
    lg: "h-8 w-8 border-2",
  };

  return (
    <div
      className={[
        "rounded-full border-surface-600 border-t-accent animate-spin",
        sizes[size] ?? sizes.md,
        className,
      ].join(" ")}
    />
  );
}
