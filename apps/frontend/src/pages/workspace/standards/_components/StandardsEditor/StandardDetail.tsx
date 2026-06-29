import { Pencil } from "@/icons";
import { Button } from "@/components/primitives";
import type { StandardRecord } from "@/lib/format";
import { MetadataChip } from "../shared/MetadataChip";
import { DoDoNotList, StandardSummaryList } from "../shared/lists";
import { familyLabel, shortStandardId, statusTone } from "../shared/standards-model";

export function StandardDetail({ onEdit, record }: { onEdit: () => void; record: StandardRecord }) {
  const rows: Array<{ label: string; value?: string; tone?: string; title?: string }> = [
    { label: "Status", value: record.status, tone: statusTone(record.status) },
    { label: "Family", value: record.family ? familyLabel(record.family) : undefined, title: record.family ?? undefined },
    { label: "Disposition", value: record.disposition },
    { label: "Severity", value: record.severity },
    { label: "QA", value: record.qaEnforcement },
    { label: "Worker", value: record.workerFacing === false ? "not injected" : "injected" },
    { label: "Retired Into", value: record.retiredInto ?? undefined },
  ].filter((row) => row.value);

  return (
    <div className="p-5 lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[18px] font-bold leading-snug text-fg" title={record.title || shortStandardId(record.id)}>
          {record.title || shortStandardId(record.id)}
        </h3>
        <Button className="shrink-0" icon={<Pencil size={13} />} onClick={onEdit} type="button">
          Edit
        </Button>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          <StandardSummaryList items={record.summary} />
        </div>
        <div className="min-w-0">
          <div className="overflow-hidden border border-line bg-card">
            {rows.map((row, index) => (
              <div className={`grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2 px-2.5 py-1.5 ${index === 0 ? "" : "border-t border-line"}`} key={row.label}>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.1em] text-dim" title={row.label}>
                  {row.label}
                </span>
                <span className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold ${row.tone ?? "text-soft"}`} title={row.title ?? row.value}>
                  {row.value}
                </span>
              </div>
            ))}
            {record.qaRuleIds?.length ? (
              <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2 border-t border-line px-2.5 py-1.5">
                <span className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.1em] text-dim" title="QA Rules">
                  QA Rules
                </span>
                <div className="flex flex-wrap gap-1">
                  {record.qaRuleIds.map((ruleId) => (
                    <MetadataChip key={ruleId} value={ruleId} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DoDoNotList items={record.do} label="Do" empty="No positive checks recorded." tone="do" />
        <DoDoNotList items={record.doNot} label="Do Not" empty="No forbidden shortcuts recorded." tone="do-not" />
      </div>
    </div>
  );
}
