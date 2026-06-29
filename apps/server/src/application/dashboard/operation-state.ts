export type OperationStepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type OperationStatus = "running" | "done" | "failed";

export interface OperationStepRecord {
  name: string;
  status: OperationStepStatus;
  startedAt?: string;
  endedAt?: string;
  detail?: string;
}

export interface OperationRecord {
  name: string;
  label: string;
  status: OperationStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
  next?: string;
  steps: OperationStepRecord[];
}

export interface OperationStateService {
  beginOperation: (name: string, label: string, stepNames: string[]) => void;
  operationStep: (stepName: string, detail?: string) => void;
  operationStepDetail: (stepName: string, detail: string) => void;
  operationNextHint: (next: string) => void;
  failOperationStep: (stepName: string) => void;
  endOperation: (error?: unknown) => void;
  withOperation: <T>(name: string, label: string, stepNames: string[], fn: () => Promise<T>) => Promise<T>;
  getOperation: () => OperationRecord | null;
  getOperationSnapshot: () => OperationRecord | null;
}

function cloneOperation(operation: OperationRecord | null): OperationRecord | null {
  return operation ? (JSON.parse(JSON.stringify(operation)) as OperationRecord) : null;
}

export function createOperationStateService(): OperationStateService {
  let operation: OperationRecord | null = null;

  function beginOperation(name: string, label: string, stepNames: string[]): void {
    operation = {
      name,
      label,
      status: "running",
      startedAt: new Date().toISOString(),
      steps: stepNames.map((stepName) => ({ name: stepName, status: "pending" as const })),
    };
  }

  function operationStep(stepName: string, detail?: string): void {
    if (!operation || operation.status !== "running") return;
    const now = new Date().toISOString();
    for (const step of operation.steps) {
      if (step.status === "running") {
        step.status = "done";
        step.endedAt = now;
      }
    }
    let step = operation.steps.find((candidate) => candidate.name === stepName);
    if (!step) {
      step = { name: stepName, status: "pending" };
      operation.steps.push(step);
    }
    step.status = "running";
    step.startedAt = now;
    if (detail) step.detail = detail;
  }

  function operationStepDetail(stepName: string, detail: string): void {
    if (!operation) return;
    const step = operation.steps.find((candidate) => candidate.name === stepName);
    if (step) step.detail = detail;
  }

  function operationNextHint(next: string): void {
    if (operation) operation.next = next;
  }

  function failOperationStep(stepName: string): void {
    if (!operation || operation.status !== "running") return;
    const now = new Date().toISOString();
    for (const step of operation.steps) {
      if (step.status === "running") {
        step.status = "done";
        step.endedAt = now;
      }
    }
    const step = operation.steps.find((candidate) => candidate.name === stepName);
    if (step) {
      step.status = "failed";
      step.endedAt = now;
    }
  }

  function endOperation(error?: unknown): void {
    if (!operation || operation.status !== "running") return;
    const now = new Date().toISOString();
    for (const step of operation.steps) {
      if (step.status === "running") {
        step.status = error ? "failed" : "done";
        step.endedAt = now;
      } else if (step.status === "pending") {
        step.status = "skipped";
      }
    }
    operation.status = error ? "failed" : "done";
    operation.endedAt = now;
    if (error) operation.error = error instanceof Error ? error.message : String(error);
  }

  async function withOperation<T>(name: string, label: string, stepNames: string[], fn: () => Promise<T>): Promise<T> {
    const owns = !operation || operation.status !== "running";
    if (owns) beginOperation(name, label, stepNames);
    try {
      const result = await fn();
      if (owns) endOperation();
      return result;
    } catch (error) {
      if (owns) endOperation(error);
      throw error;
    }
  }

  return {
    beginOperation,
    operationStep,
    operationStepDetail,
    operationNextHint,
    failOperationStep,
    endOperation,
    withOperation,
    getOperation: () => operation,
    getOperationSnapshot: () => cloneOperation(operation),
  };
}

export const operationState = createOperationStateService();

export const beginOperation = operationState.beginOperation;
export const operationStep = operationState.operationStep;
export const operationStepDetail = operationState.operationStepDetail;
export const operationNextHint = operationState.operationNextHint;
export const failOperationStep = operationState.failOperationStep;
export const endOperation = operationState.endOperation;
export const withOperation = operationState.withOperation;
export const getOperation = operationState.getOperation;
export const getOperationSnapshot = operationState.getOperationSnapshot;
