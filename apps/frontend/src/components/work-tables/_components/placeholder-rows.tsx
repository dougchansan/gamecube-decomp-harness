import { Fragment } from "react";

export function PlaceholderRows({
  columns,
  count,
  rhythm,
  startIndex = 0,
}: {
  columns: number;
  count: number;
  rhythm: "match" | "active" | "queue";
  startIndex?: number;
}) {
  if (count <= 0) return null;
  return (
    <>
      {Array.from({ length: count }, (_, index) => {
        const alt = (startIndex + index) % 2 === 1 ? "entry-alt" : "";
        return rhythm === "active" ? (
          <Fragment key={`placeholder-${index}`}>
            <tr aria-hidden className={`placeholder-row row-rhythm-main ${alt}`}>
              <td colSpan={columns} />
            </tr>
            <tr aria-hidden className={`placeholder-row row-rhythm-sub ${alt}`}>
              <td colSpan={columns} />
            </tr>
          </Fragment>
        ) : (
          <tr aria-hidden className={`placeholder-row ${rhythm === "queue" ? "row-rhythm-2" : "row-rhythm-1"}`} key={`placeholder-${index}`}>
            <td colSpan={columns} />
          </tr>
        );
      })}
    </>
  );
}
