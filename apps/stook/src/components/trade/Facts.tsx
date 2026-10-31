// The round in numbers, beside the order: when it opened, what is in it, how
// tall each row is, and when trading stops and the bell rings.
export interface Fact { k: string; v: string; d?: string; tone?: "up" | "down" }

export function RoundFacts({ items, title = "This round" }: { items: Fact[]; title?: string }) {
  return (
    <section className="card trade-facts" aria-label={title}>
      <h3 className="label">{title}</h3>
      <dl>
        {items.map((f) => (
          <div key={f.k}>
            <dt>{f.k}</dt>
            <dd><b className={`num${f.tone ? ` ${f.tone}` : ""}`}>{f.v}</b>{f.d && <small>{f.d}</small>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
