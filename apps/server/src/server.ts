export { closeKernelRuntimeForTests, fetchServer, serveServer } from "@server/infrastructure/http/server";
import { serveServer } from "@server/infrastructure/http/server";

if (import.meta.main) {
  const server = serveServer();
  await new Promise<void>(() => {
    void server;
  });
}
