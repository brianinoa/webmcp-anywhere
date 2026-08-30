export function JsonBlock({ value, summary, open = false }: { value: unknown; summary?: string; open?: boolean }) {
  const text = JSON.stringify(value, null, 2);
  if (!summary) return <pre className="code">{text}</pre>;
  return (
    <details className="details" open={open}>
      <summary>{summary}</summary>
      <pre className="code">{text}</pre>
    </details>
  );
}
