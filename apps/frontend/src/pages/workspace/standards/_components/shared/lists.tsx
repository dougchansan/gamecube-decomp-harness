export function DescriptionBullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Description" className="example-description-list">
      {items.map((item, index) => (
        <li key={`${item.slice(0, 48)}-${index}`}>
          <span aria-hidden="true" className="example-description-bullet">
            •
          </span>
          <span className="example-description-text">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function StandardSummaryList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Summary" className="standard-summary-list">
      {items.map((item, index) => (
        <li key={`${item.slice(0, 48)}-${index}`}>
          <span aria-hidden="true" className="standard-summary-bullet">
            •
          </span>
          <span className="standard-summary-text">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function DoDoNotList({ empty, items, label, tone }: { empty: string; items: string[]; label: string; tone: "do" | "do-not" }) {
  return (
    <div className="overflow-hidden border border-line bg-card">
      <div className="flex items-center gap-1.5 bg-raised px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-dim">{label}</div>
      {items.length === 0 ? (
        <p className="m-0 px-3 py-3 text-[13px] text-faint">{empty}</p>
      ) : (
        <ul className={`standard-description-list standard-description-list-${tone} standard-description-list-divided`}>
          {items.map((item, index) => (
            <li key={`${item.slice(0, 40)}-${index}`}>
              <span aria-hidden="true" className="standard-description-bullet">
                •
              </span>
              <span className="standard-description-text">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
