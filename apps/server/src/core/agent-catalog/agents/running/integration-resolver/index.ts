export {
  INTEGRATION_RESOLVER_SCHEMA_VERSION,
  integrationResolverPrompt,
  validateIntegrationResolverAgentResult,
  type IntegrationResolverAgentResult,
  type IntegrationResolverPromptOptions,
} from "./prompt.js";

export const integrationResolverAgent = {
  id: "integration-resolver",
  role: "integration-resolver",
  toolProfile: "integration-resolver",
  schemaPath: "apps/server/src/core/agent-catalog/agents/running/integration-resolver/schema.json",
  purpose: "Resolve running-phase worker-output integration queue conflicts before PR handoff.",
} as const;
