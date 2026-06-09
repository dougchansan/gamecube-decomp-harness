import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, FileText, Minus, Plus, RefreshCw } from "lucide-react";
import {
  asArray,
  asObject,
  text,
  type PromptPreview,
  type PromptPreviewAgentId,
  type PromptPreviewSource,
  type PromptPreviewStats,
  type UiConfig,
} from "@decomp-orchestrator/ui-contract";
import { fetchPromptPreview, loadConfig, projectOptionLabel, type AgentViewerForm } from "../lib/api";
import { Button } from "./primitives";

type PromptKind = "system" | "user";

const DEFAULT_PROMPT_FONT_SIZE = 12;
const MIN_PROMPT_FONT_SIZE = 10;
const MAX_PROMPT_FONT_SIZE = 18;

interface AccessRow {
  title: string;
  body?: string;
  code?: string;
  meta?: string;
  chips?: string[];
}

interface AccessGroup {
  id: string;
  title: string;
  rows: AccessRow[];
  emptyText: string;
  initiallyOpen?: boolean;
}

const agents: Array<{ id: PromptPreviewAgentId; label: string }> = [
  { id: "director", label: "Director" },
  { id: "worker", label: "Worker" },
  { id: "pr-review", label: "PR Review" },
  { id: "knowledge-curator", label: "Curator" },
];

const sources: Array<{ id: PromptPreviewSource; label: string }> = [
  { id: "latest", label: "Latest Run" },
  { id: "sample", label: "Sample" },
];

function defaultPromptForm(): AgentViewerForm {
  return {
    projectId: "",
    usePathOverrides: false,
    repoRoot: "",
    stateDir: "",
    graphDbPath: "",
  };
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function clampPromptFontSize(value: number): number {
  return Math.min(MAX_PROMPT_FONT_SIZE, Math.max(MIN_PROMPT_FONT_SIZE, value));
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`/g;
  let lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(value.slice(lastIndex, index));
    nodes.push(
      <code className="prompt-inline-code" key={`${keyPrefix}-code-${index}`}>
        {match[1]}
      </code>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function isXmlLine(line: string): boolean {
  return /^<\/?[A-Za-z0-9_:-]+(?:\s[^>]*)?>$/.test(line.trim());
}

function renderJsonLine(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g;
  let lastIndex = 0;

  for (const match of line.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(line.slice(lastIndex, index));
    const value = match[0];
    const stringPart = match[1];
    const keySuffix = match[2] ?? "";
    const key = `${keyPrefix}-json-${index}`;

    if (stringPart && keySuffix) {
      nodes.push(
        <span className="prompt-json-key" key={`${key}-key`}>
          {stringPart}
        </span>,
      );
      nodes.push(
        <span className="prompt-json-punctuation" key={`${key}-suffix`}>
          {keySuffix}
        </span>,
      );
    } else if (value.startsWith('"')) {
      nodes.push(
        <span className="prompt-json-string" key={key}>
          {value}
        </span>,
      );
    } else if (/^-?\d/.test(value)) {
      nodes.push(
        <span className="prompt-json-number" key={key}>
          {value}
        </span>,
      );
    } else if (value === "true" || value === "false") {
      nodes.push(
        <span className="prompt-json-boolean" key={key}>
          {value}
        </span>,
      );
    } else if (value === "null") {
      nodes.push(
        <span className="prompt-json-null" key={key}>
          {value}
        </span>,
      );
    } else {
      nodes.push(
        <span className="prompt-json-punctuation" key={key}>
          {value}
        </span>,
      );
    }
    lastIndex = index + value.length;
  }

  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
}

function RenderedPrompt({ fontSize, text: prompt }: { fontSize: number; text: string }) {
  const rows = useMemo(() => {
    const lines = prompt.split(/\r\n|\r|\n/);
    let inCode = false;
    let codeLanguage = "";
    return lines.map((line, index) => {
      const trimmed = line.trim();
      const lineNumber = index + 1;
      const fence = trimmed.startsWith("```");
      const wasInCode = inCode;
      const languageForLine = wasInCode ? codeLanguage : fence ? trimmed.slice(3).trim().toLowerCase() : "";
      if (fence) {
        if (wasInCode) {
          inCode = false;
          codeLanguage = "";
        } else {
          inCode = true;
          codeLanguage = languageForLine;
        }
      }

      let className = "prompt-line";
      let content: ReactNode = renderInline(line, `line-${lineNumber}`);
      if (!trimmed) {
        className += " prompt-line-blank";
        content = "\u00a0";
      } else if (wasInCode || fence) {
        className += fence ? " prompt-line-code-fence" : " prompt-line-code";
        if (!fence && languageForLine === "json") {
          className += " prompt-line-json";
          content = renderJsonLine(line || " ", `json-${lineNumber}`);
        } else {
          content = line || "\u00a0";
        }
      } else if (isXmlLine(trimmed)) {
        className += " prompt-line-xml";
      }

      return (
        <div className={className} key={lineNumber}>
          <div className="prompt-line-number">{lineNumber}</div>
          <div className="prompt-line-content">{content}</div>
        </div>
      );
    });
  }, [prompt]);

  return (
    <article className="prompt-rendered" style={{ fontSize }}>
      {rows}
    </article>
  );
}

function JsonLineView({ text: value }: { text: string }) {
  const rows = useMemo(
    () =>
      value.split(/\r\n|\r|\n/).map((line, index) => {
        const lineNumber = index + 1;
        return (
          <div className="prompt-context-line" key={lineNumber}>
            <div className="prompt-context-line-number">{lineNumber}</div>
            <div className="prompt-context-line-content">{renderJsonLine(line || " ", `context-json-${lineNumber}`)}</div>
          </div>
        );
      }),
    [value],
  );

  return <article className="prompt-context-rendered">{rows}</article>;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fence?.[1] ?? trimmed).trim();
}

function taggedBlock(prompt: string, tag: string): string {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i");
  return pattern.exec(prompt)?.[1] ?? "";
}

function taggedJson(prompt: string, tag: string): unknown {
  const block = taggedBlock(prompt, tag);
  if (!block) return null;
  try {
    return JSON.parse(stripJsonFence(block));
  } catch {
    return null;
  }
}

function accessString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function accessArrayStrings(value: unknown): string[] {
  return asArray(value)
    .map((item) => accessString(item))
    .filter(Boolean);
}

function rowFromPathLike(value: unknown, fallbackTitle: string): AccessRow | null {
  if (typeof value === "string") {
    return { title: fallbackTitle, code: value };
  }
  const item = asObject(value);
  const path = accessString(item.path);
  const command = accessString(item.command);
  const label = accessString(item.id) || accessString(item.title) || accessString(item.kind) || fallbackTitle;
  const purpose = accessString(item.purpose) || accessString(item.reason) || accessString(item.description);
  const cwd = accessString(item.cwd);
  const code = command || path || accessString(item.value);
  if (!label && !purpose && !code) return null;
  return {
    title: label,
    body: purpose,
    code,
    meta: cwd ? `cwd: ${cwd}` : undefined,
    chips: accessArrayStrings(item.fields),
  };
}

function rowsFromArray(value: unknown, fallbackTitle: string): AccessRow[] {
  return asArray(value)
    .map((item, index) => rowFromPathLike(item, `${fallbackTitle} ${index + 1}`))
    .filter((row): row is AccessRow => Boolean(row));
}

function rowsFromRecord(value: unknown): AccessRow[] {
  return Object.entries(asObject(value))
    .map(([key, entry]) => {
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        return { title: key, code: String(entry) };
      }
      const row = rowFromPathLike(entry, key);
      return row ? { ...row, title: row.title === key ? key : `${key}: ${row.title}` } : null;
    })
    .filter((row): row is AccessRow => Boolean(row));
}

function toolRows(prompt: string): AccessRow[] {
  return asArray(taggedJson(prompt, "available_pi_tools_json"))
    .map((item): AccessRow | null => {
      const tool = asObject(item);
      const title = accessString(tool.id);
      if (!title) return null;
      return {
        title,
        body: accessString(tool.purpose),
        chips: accessArrayStrings(tool.capabilities),
      };
    })
    .filter((row): row is AccessRow => Boolean(row));
}

function filesToReadRows(prompt: string): AccessRow[] {
  return rowsFromArray(taggedJson(prompt, "files_to_read_first_json"), "File");
}

function resourceGroups(prompt: string): AccessGroup[] {
  const resources = asObject(taggedJson(prompt, "available_resources_json"));
  if (!Object.keys(resources).length) return [];
  const agentContext = asObject(resources.agent_context);
  const pastPrs = asObject(resources.past_prs);
  const decompResources = asObject(resources.decomp_resources);
  const knowledgeGraph = asObject(resources.knowledge_graph);

  const resourceRows = [
    ...rowsFromRecord(resources.roots),
    ...rowsFromArray(resources.progress_inputs, "Progress input"),
    ...rowsFromArray(resources.target_metadata, "Target metadata"),
    ...rowsFromArray(resources.local_context, "Local context"),
    rowFromPathLike(asObject(pastPrs.structured_index), "Past PR structured index"),
    rowFromPathLike(pastPrs.known_fixes, "Past PR known fixes"),
    ...rowsFromArray(pastPrs.raw_analysis, "Past PR analysis"),
    rowFromPathLike(decompResources.index, "Resource guide index"),
    rowFromPathLike(decompResources.notes, "Resource guide notes"),
    rowFromPathLike(decompResources.data_sheet_csv_dir, "Data sheet CSV directory"),
    ...rowsFromArray(decompResources.data_sheet_csvs, "Data sheet CSV"),
    rowFromPathLike(decompResources.powerpc_index, "PowerPC index"),
    ...rowsFromArray(decompResources.external_hint_indexes, "External hint index"),
    rowFromPathLike(knowledgeGraph.sources_root, "Knowledge sources root"),
    rowFromPathLike(knowledgeGraph.tools_root, "Knowledge tools root"),
    rowFromPathLike(knowledgeGraph.graph_root, "Knowledge graph root"),
    rowFromPathLike(knowledgeGraph.graph_db, "Knowledge graph DB"),
    {
      title: "Knowledge graph IDs",
      body: accessString(knowledgeGraph.cli_policy),
      chips: [...accessArrayStrings(knowledgeGraph.source_ids), ...accessArrayStrings(knowledgeGraph.tool_ids)],
    },
  ].filter((row): row is AccessRow => Boolean(row));

  return [
    {
      id: "agent-context",
      title: "Agent Context Files",
      rows: [...rowsFromArray(agentContext.selected_references, "Context file"), ...rowsFromRecord(agentContext.scripts)],
      emptyText: "No context files are listed in the rendered prompt.",
    },
    {
      id: "resources",
      title: "Resources",
      rows: resourceRows,
      emptyText: "No resources are listed in the rendered prompt.",
    },
    {
      id: "commands",
      title: "Commands And Tools",
      rows: [
        ...rowsFromArray(resources.helper_scripts, "Helper script"),
        ...rowsFromArray(resources.optional_experimental_tools, "Experimental tool"),
        ...rowsFromArray(resources.commands, "Command"),
        ...rowsFromArray(knowledgeGraph.commands, "Knowledge graph command"),
        ...rowsFromArray(resources.optional_experimental_commands, "Experimental command"),
      ],
      emptyText: "No commands are listed in the rendered prompt.",
    },
  ];
}

function buildAccessGroups(prompt: string): AccessGroup[] {
  const tools = toolRows(prompt);
  const files = filesToReadRows(prompt);
  return [
    {
      id: "pi-tools",
      title: "Pi Tools",
      rows: tools,
      emptyText: "This rendered agent prompt does not declare Pi custom tools.",
      initiallyOpen: true,
    },
    {
      id: "files",
      title: "Files To Read First",
      rows: files,
      emptyText: "This rendered agent prompt does not declare first-read files.",
      initiallyOpen: tools.length === 0 && files.length > 0,
    },
    ...resourceGroups(prompt),
  ];
}

function AccessGroupView({ group }: { group: AccessGroup }) {
  return (
    <details className="prompt-access-group" open={group.initiallyOpen}>
      <summary>
        <span>{group.title}</span>
        <span>{group.rows.length}</span>
      </summary>
      {group.rows.length ? (
        <div className="prompt-access-rows">
          {group.rows.map((row, index) => (
            <div className="prompt-access-row" key={`${group.id}-${row.title}-${index}`}>
              <div className="prompt-access-row-title">{row.title}</div>
              {row.body ? <div className="prompt-access-row-body">{row.body}</div> : null}
              {row.code ? <code className="prompt-access-row-code">{row.code}</code> : null}
              {row.meta ? <div className="prompt-access-row-meta">{row.meta}</div> : null}
              {row.chips?.length ? (
                <div className="prompt-access-chips">
                  {row.chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="prompt-muted">{group.emptyText}</p>
      )}
    </details>
  );
}

function AgentAccessPanel({ prompt }: { prompt: string }) {
  const groups = useMemo(() => buildAccessGroups(prompt), [prompt]);
  const toolCount = groups.find((group) => group.id === "pi-tools")?.rows.length ?? 0;
  const fileCount = groups.find((group) => group.id === "files")?.rows.length ?? 0;
  const commandCount = groups.find((group) => group.id === "commands")?.rows.length ?? 0;
  const resourceCount = groups.find((group) => group.id === "resources")?.rows.length ?? 0;

  return (
    <section>
      <div className="prompt-inspector-title">Agent Access</div>
      <div className="prompt-access-summary">
        <span>{formatCount(toolCount)} tools</span>
        <span>{formatCount(fileCount)} files</span>
        <span>{formatCount(resourceCount)} resources</span>
        <span>{formatCount(commandCount)} commands</span>
      </div>
      <div className="prompt-access-list">
        {groups.map((group) => (
          <AccessGroupView group={group} key={group.id} />
        ))}
      </div>
    </section>
  );
}

function PromptStats({ stats }: { stats: PromptPreviewStats }) {
  return (
    <div className="prompt-stats">
      <span>{formatCount(stats.lines)} lines</span>
      <span>{formatCount(stats.words)} words</span>
      <span>{formatCount(stats.characters)} chars</span>
      {stats.unresolvedPlaceholders.length ? <span className="prompt-stat-warning">{stats.unresolvedPlaceholders.length} unresolved</span> : null}
    </div>
  );
}

function PromptFontControls({
  fontSize,
  onDecrease,
  onIncrease,
}: {
  fontSize: number;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div aria-label="Prompt text size" className="prompt-font-controls" role="group">
      <button aria-label="Decrease prompt text size" disabled={fontSize <= MIN_PROMPT_FONT_SIZE} onClick={onDecrease} title="Decrease prompt text size" type="button">
        <Minus size={14} />
      </button>
      <span aria-live="polite">{fontSize}px</span>
      <button aria-label="Increase prompt text size" disabled={fontSize >= MAX_PROMPT_FONT_SIZE} onClick={onIncrease} title="Increase prompt text size" type="button">
        <Plus size={14} />
      </button>
    </div>
  );
}

function PromptDocument({
  fontSize,
  onDecreaseFontSize,
  onCopy,
  onIncreaseFontSize,
  stats,
  templatePath,
  text: prompt,
  title,
}: {
  fontSize: number;
  onDecreaseFontSize: () => void;
  onCopy: () => void;
  onIncreaseFontSize: () => void;
  stats: PromptPreviewStats;
  templatePath: string;
  text: string;
  title: string;
}) {
  return (
    <section className="prompt-document">
      <header className="prompt-document-header">
        <div className="min-w-0">
          <div className="prompt-document-title">{title}</div>
          <div className="prompt-template-path" title={templatePath}>
            {templatePath}
          </div>
        </div>
        <div className="prompt-document-actions">
          <PromptFontControls fontSize={fontSize} onDecrease={onDecreaseFontSize} onIncrease={onIncreaseFontSize} />
          <Button className="h-8 min-w-8 px-2" icon={<Copy size={14} />} onClick={onCopy} title={`Copy ${title.toLowerCase()} prompt`} type="button">
            Copy
          </Button>
        </div>
      </header>
      <PromptStats stats={stats} />
      {stats.unresolvedPlaceholders.length ? <div className="prompt-warning-line">Unresolved: {stats.unresolvedPlaceholders.join(", ")}</div> : null}
      <div className="prompt-document-body">
        <RenderedPrompt fontSize={fontSize} text={prompt} />
      </div>
    </section>
  );
}

export function AgentViewer() {
  const [config, setConfig] = useState<UiConfig | null>(null);
  const [form, setForm] = useState<AgentViewerForm>(defaultPromptForm);
  const [agent, setAgent] = useState<PromptPreviewAgentId>("worker");
  const [source, setSource] = useState<PromptPreviewSource>("latest");
  const [promptKind, setPromptKind] = useState<PromptKind>("system");
  const [preview, setPreview] = useState<PromptPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [promptFontSize, setPromptFontSize] = useState(DEFAULT_PROMPT_FONT_SIZE);

  useEffect(() => {
    void loadConfig()
      .then((loaded) => {
        setConfig(loaded);
        setForm({
          projectId: loaded.defaultProjectId,
          usePathOverrides: false,
          repoRoot: loaded.defaultRepoRoot,
          stateDir: loaded.defaultStateDir,
          graphDbPath: loaded.defaultGraphDbPath,
        });
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)));
  }, []);

  useEffect(() => {
    if (!config) return;
    setLoading(true);
    setError("");
    void fetchPromptPreview(form, agent, source)
      .then(setPreview)
      .catch((loadError) => {
        setPreview(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => setLoading(false));
  }, [agent, config, form, refreshTick, source]);

  const projects = config?.availableProjects ?? [];
  const selectedProject = projects.find((project) => project.id === form.projectId) ?? config?.selectedProject ?? null;
  const context = asObject(preview?.context);
  const contextJson = text(context.renderedContextJson) || JSON.stringify(preview?.context ?? {}, null, 2);
  const contextSummary = preview ? `${preview.contextSource === "latest" ? "latest run" : "sample"} / ${preview.agent}` : "loading";
  const projectLabel = preview?.project?.displayName ?? selectedProject?.displayName ?? form.projectId;
  const graphLabel = preview?.graphDbPath ?? form.graphDbPath;
  const activePrompt = preview
    ? promptKind === "system"
      ? {
          label: "System Prompt",
          text: preview.systemPrompt,
          stats: preview.systemStats,
          templatePath: preview.systemTemplatePath,
        }
      : {
          label: "User Prompt",
          text: preview.userPrompt,
          stats: preview.userStats,
          templatePath: preview.userTemplatePath,
        }
    : null;

  const copyText = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? "" : current)), 1400);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }, []);

  return (
    <main className="prompt-app min-h-screen bg-[#f6f8fa] text-[#24292f]">
      <header className="prompt-toolbar">
        <div className="prompt-toolbar-title">
          <FileText size={18} />
          <div className="min-w-0">
            <h1>Agent Viewer</h1>
            <p>{preview ? `${preview.repoRoot} -> ${preview.stateDir}` : "Loading prompt context"}</p>
          </div>
        </div>
      </header>

      <section className="prompt-controls">
        <label>
          <span>Project</span>
          <select
            disabled={form.usePathOverrides}
            onChange={(event) => {
              const project = projects.find((item) => item.id === event.currentTarget.value);
              setForm({
                projectId: event.currentTarget.value,
                usePathOverrides: false,
                repoRoot: project?.repoRoot ?? form.repoRoot,
                stateDir: project?.stateDir ?? form.stateDir,
                graphDbPath: project?.graphDbPath ?? form.graphDbPath,
              });
            }}
            value={form.projectId}
          >
            {(projects.length ? projects : selectedProject ? [selectedProject] : []).map((project) => (
              <option key={project.id} value={project.id}>
                {projectOptionLabel(project)}
              </option>
            ))}
            {!projects.length && !selectedProject ? <option value="">Default paths</option> : null}
          </select>
        </label>

        <label>
          <span>Agent</span>
          <select onChange={(event) => setAgent(event.currentTarget.value as PromptPreviewAgentId)} value={agent}>
            {agents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Source</span>
          <select onChange={(event) => setSource(event.currentTarget.value as PromptPreviewSource)} value={source}>
            {sources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="prompt-checkbox">
          <input checked={form.usePathOverrides} onChange={(event) => setForm((current) => ({ ...current, usePathOverrides: event.currentTarget.checked }))} type="checkbox" />
          <span>Custom paths</span>
        </label>

        <Button disabled={loading} icon={<RefreshCw size={14} />} onClick={() => setRefreshTick((tick) => tick + 1)} title="Render the selected prompt again" type="button">
          Refresh
        </Button>
      </section>

      {form.usePathOverrides ? (
        <section className="prompt-path-overrides">
          <label>
            <span>Repo root</span>
            <input onChange={(event) => setForm((current) => ({ ...current, repoRoot: event.currentTarget.value }))} spellCheck={false} value={form.repoRoot} />
          </label>
          <label>
            <span>State dir</span>
            <input onChange={(event) => setForm((current) => ({ ...current, stateDir: event.currentTarget.value }))} spellCheck={false} value={form.stateDir} />
          </label>
          <label>
            <span>Graph DB</span>
            <input onChange={(event) => setForm((current) => ({ ...current, graphDbPath: event.currentTarget.value }))} spellCheck={false} value={form.graphDbPath} />
          </label>
        </section>
      ) : null}

      <section className="prompt-status-band">
        <div>
          <span>Context</span>
          <strong>{contextSummary}</strong>
        </div>
        <div>
          <span>Project</span>
          <strong>{projectLabel || "-"}</strong>
        </div>
        <div>
          <span>Graph</span>
          <strong title={graphLabel}>{graphLabel || "-"}</strong>
        </div>
        {copied ? (
          <div className="prompt-copy-state">
            <Check size={14} />
            <strong>{copied} copied</strong>
          </div>
        ) : null}
      </section>

      {error ? <div className="prompt-error">{error}</div> : null}

      {preview && activePrompt ? (
        <div className="prompt-workspace">
          <div className="prompt-reader">
            <div className="prompt-prompt-selector" role="group" aria-label="Prompt">
              <button className={promptKind === "system" ? "active" : ""} onClick={() => setPromptKind("system")} type="button">
                System Prompt
              </button>
              <button className={promptKind === "user" ? "active" : ""} onClick={() => setPromptKind("user")} type="button">
                User Prompt
              </button>
            </div>
            <PromptDocument
              fontSize={promptFontSize}
              onDecreaseFontSize={() => setPromptFontSize((current) => clampPromptFontSize(current - 1))}
              onCopy={() => void copyText(promptKind === "system" ? "System" : "User", activePrompt.text)}
              onIncreaseFontSize={() => setPromptFontSize((current) => clampPromptFontSize(current + 1))}
              stats={activePrompt.stats}
              templatePath={activePrompt.templatePath}
              text={activePrompt.text}
              title={activePrompt.label}
            />
          </div>

          <aside className="prompt-inspector">
            <section>
              <div className="prompt-inspector-title">Warnings</div>
              {preview.warnings.length ? (
                <ul className="prompt-warning-list">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <p className="prompt-muted">No render warnings.</p>
              )}
            </section>

            <AgentAccessPanel prompt={preview.userPrompt} />

            <section>
              <div className="prompt-inspector-header">
                <div className="prompt-inspector-title">Injected Context</div>
                <Button className="h-8 min-w-8 px-2" icon={<Copy size={14} />} onClick={() => void copyText("Context", contextJson)} title="Copy context JSON" type="button">
                  Copy
                </Button>
              </div>
              <div className="prompt-context-json">
                <JsonLineView text={contextJson} />
              </div>
            </section>
          </aside>
        </div>
      ) : (
        <div className="prompt-loading">{loading ? "Rendering prompt preview..." : "No prompt preview loaded."}</div>
      )}
    </main>
  );
}
