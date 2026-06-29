import { AlertTriangle } from "@/icons";
import { PanelSection, PanelTitle } from "@/components/primitives";
import type { FormState } from "@/lib/format";
import { useStandardsPayload } from "../data/useStandardsPayload";
import { EffectivePreview } from "./EffectivePreview";

export function RenderedStandardsPanel({ form }: { form: FormState }) {
  const { state } = useStandardsPayload(form);

  if (state.loading) {
    return (
      <PanelSection>
        <PanelTitle>Effective Prompt</PanelTitle>
        <p className="m-0 text-xs text-dim">Loading rendered prompt…</p>
      </PanelSection>
    );
  }

  if (state.error) {
    return (
      <PanelSection className="border-down/50">
        <PanelTitle>Effective Prompt</PanelTitle>
        <div className="flex items-start gap-2 text-xs text-down">
          <AlertTriangle className="mt-0.5 shrink-0" size={14} />
          <span className="min-w-0">{state.error}</span>
        </div>
      </PanelSection>
    );
  }

  return <EffectivePreview payload={state.payload} />;
}
