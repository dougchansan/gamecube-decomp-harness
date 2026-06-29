import { asObject, type FormState, type UiConfig } from "@/lib/format";
import { CheckboxField, Field, InfoRows, List, PageHeader, PanelSection, PanelTitle, SelectField } from "@/components/primitives";
import { processName } from "@/pages/workspace/_lib/model";
import type { SessionView, WorkspaceNav } from "@/pages/workspace/_lib/types";

export function SettingsPage({ config, form, nav, setForm, view }: { config: UiConfig | null; form: FormState; nav: WorkspaceNav; setForm: (updates: Partial<FormState>) => void; view: SessionView }) {
  const projects = config?.availableProjects ?? [];
  const defaults = asObject(config?.projectDefaults);
  const validation = asObject(defaults.validation);
  const pr = asObject(defaults.pr);
  return (
    <>
      <PageHeader kicker={view.project?.displayName ?? "No project selected"} title="Settings" />
      <div className="@container grid min-h-0 flex-1 content-start gap-4 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-4 @[760px]:grid-cols-[minmax(320px,0.75fr)_minmax(0,1fr)]">
          <PanelSection>
            <PanelTitle>Project Selection</PanelTitle>
            <SelectField
              label="Project"
              onChange={(event) => {
                const project = projects.find((item) => item.id === event.currentTarget.value);
                setForm({
                  projectId: event.currentTarget.value,
                  usePathOverrides: false,
                  repoRoot: project?.repoRoot ?? form.repoRoot,
                  stateDir: project?.stateDir ?? form.stateDir,
                  graphDbPath: project?.graphDbPath ?? form.graphDbPath,
                  processName: project?.processName ?? form.processName,
                });
              }}
              options={projects.length ? projects.map((project) => project.id) : [form.projectId || ""]}
              value={form.projectId}
            />
            <CheckboxField checked={form.usePathOverrides} label="Use custom paths" onChange={(event) => setForm({ usePathOverrides: event.currentTarget.checked })} />
            <Field disabled={!form.usePathOverrides} label="Repo root" onChange={(event) => setForm({ repoRoot: event.currentTarget.value })} spellCheck={false} value={form.repoRoot} />
            <Field disabled={!form.usePathOverrides} label="State dir" onChange={(event) => setForm({ stateDir: event.currentTarget.value })} spellCheck={false} value={form.stateDir} />
            <Field disabled={!form.usePathOverrides} label="Graph DB" onChange={(event) => setForm({ graphDbPath: event.currentTarget.value })} spellCheck={false} value={form.graphDbPath} />
            <p className="mb-0 mt-2 text-xs text-dim">
              Standards and durable project knowledge live in the <button className="text-accent underline-offset-2 hover:underline" onClick={() => nav.goToSection("standards")} type="button">Standards</button> page, not here.
            </p>
          </PanelSection>
          <PanelSection>
            <PanelTitle>Path Health</PanelTitle>
            <InfoRows
              rows={[
                ["Repo", form.repoRoot || view.project?.repoRoot || "-", view.project?.repoRootExists === false ? "text-down" : "text-soft"],
                ["State", form.stateDir || view.project?.stateDir || "-", view.project?.stateDirExists === false ? "text-down" : "text-soft"],
                ["Graph", form.graphDbPath || view.project?.graphDbPath || "-", view.project?.graphDbExists === false ? "text-down" : "text-soft"],
                ["Process", processName(form.processName || view.project?.processName)],
                ["Base ref", view.project?.baseRef ?? "-"],
              ]}
            />
          </PanelSection>
        </div>
        <div className="grid grid-cols-1 gap-4 @[760px]:grid-cols-2">
          <PanelSection>
            <PanelTitle>Validation Defaults</PanelTitle>
            <List values={Object.entries(validation).map(([key, value]) => `${key}: ${String(value)}`)} empty="No validation defaults configured." />
          </PanelSection>
          <PanelSection>
            <PanelTitle>PR Defaults</PanelTitle>
            <List values={Object.entries(pr).map(([key, value]) => `${key}: ${String(value)}`)} empty="No PR defaults configured." />
          </PanelSection>
        </div>
      </div>
    </>
  );
}
