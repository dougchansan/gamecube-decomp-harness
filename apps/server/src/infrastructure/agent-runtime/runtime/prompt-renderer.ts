export interface PromptTemplateValues {
  AVAILABLE_TOOLS_XML?: string;
  BASELINE_XML?: string;
  CURATOR_CONTEXT_JSON?: string;
  CURATOR_OUTPUT_SCHEMA_JSON?: string;
  CURRENT_STATE_JSON?: string;
  DECOMP_STANDARDS_XML?: string;
  FILES_TO_READ_JSON?: string;
  PI_TOOLS_JSON?: string;
  PR_CONTEXT_JSON?: string;
  PR_CONTEXT_XML?: string;
  PR_OUTPUT_SCHEMA_JSON?: string;
  PR_SPLITTER_CONTEXT_JSON?: string;
  PR_SPLITTER_OUTPUT_SCHEMA_JSON?: string;
  RESOURCES_JSON?: string;
  PRIMARY_SOURCE_PATH?: string;
  TARGET_FILE_XML?: string;
  TARGET_GRAPH_FILE_CARD_XML?: string;
  TARGET_XML?: string;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function renderTemplate(template: string, values: PromptTemplateValues): string {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (match, key: keyof PromptTemplateValues) => {
    const value = values[key];
    return typeof value === "string" ? value : match;
  });
}
