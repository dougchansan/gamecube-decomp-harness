import type { ReactNode } from "react";

export function PromptXmlViewer({ xml }: { xml: string }) {
  if (!xml.trim()) {
    return <p className="m-0 text-xs text-faint">(no rendered XML)</p>;
  }

  const lines = xml.split(/\r\n|\r|\n/);
  return (
    <div className="effective-viewer">
      <article className="ev-rendered">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const trimmed = line.trim();
          let className = "ev-line";
          let content: ReactNode = renderInlineCode(line, `ev-${lineNumber}`);
          if (!trimmed) {
            className += " ev-line-blank";
            content = "\u00a0";
          } else if (isXmlLine(trimmed)) {
            className += " ev-line-xml";
          } else if (/^#{1,6}\s/.test(trimmed)) {
            className += " ev-line-heading";
          }
          return (
            <div className={className} key={lineNumber}>
              <div className="ev-line-number">{lineNumber}</div>
              <div className="ev-line-content">{content}</div>
            </div>
          );
        })}
      </article>
    </div>
  );
}

function isXmlLine(line: string): boolean {
  return /^<\/?[A-Za-z0-9_:-]+(?:\s[^>]*)?>$/.test(line.trim());
}

function renderInlineCode(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`/g;
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(value.slice(lastIndex, index));
    nodes.push(
      <code className="ev-inline-code" key={`${keyPrefix}-code-${index}`}>
        {match[1]}
      </code>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}
