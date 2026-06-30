export function applyProcessEnvPatch(env: Record<string, string | undefined> | undefined): () => void {
  const entries = Object.entries(env ?? {});
  if (entries.length === 0) return () => {};
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of entries) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
