export function Brand({ className = "" }: { className?: string }) {
  return (
    <a
      className={`brand ${className}`.trim()}
      href="/"
      aria-label="Сложено, главная"
    >
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <h1>Сложено</h1>
    </a>
  );
}
