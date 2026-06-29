import { Fragment } from "react";
import { StackCell } from "@/components/primitives";
import { ActiveActivityRow } from "@/components/work-tables/_components/active-activity-row";
import { activeRuntime } from "@/components/work-tables/_lib/runtime";
import { pct, text, type JsonObject } from "@/lib/format";

export function ActiveRows({ rows }: { rows: JsonObject[] }) {
  return (
    <>
      {rows.map((file, index) => {
        const timing = activeRuntime(file.claimedAt || file.heartbeatAt, file.ttl);
        const alt = index % 2 === 1 ? "entry-alt" : "";
        return (
          <Fragment key={`${text(file.claimId)}-${text(file.symbol)}`}>
            <tr className={`row-rhythm-main ${alt}`}>
              <td title={text(file.sourcePath) || text(file.unit) || text(file.symbol)}>
                <StackCell primary={text(file.symbol, "-")} secondary={text(file.sourcePath) || text(file.unit)} />
              </td>
              <td className="w-[92px] text-right">{pct(file.fuzzy)}</td>
              <td className="w-32 text-right" title={timing.title}>
                <StackCell primary={timing.primary} secondary={timing.secondary} />
              </td>
            </tr>
            <ActiveActivityRow alt={alt} file={file} />
          </Fragment>
        );
      })}
    </>
  );
}
