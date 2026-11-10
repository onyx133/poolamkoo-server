import 'dotenv/config';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createContainer } from './container.js';
import { createPrisma } from './lib/prisma.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrisma(config.databaseUrl, { poolMax: config.dbPoolMax });
  const app = await buildApp(createContainer(config, prisma), config);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    // Hard exit if graceful shutdown hangs; unref so it never keeps the process alive.
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({
    host: config.host,
    port: config.port,
    // The default message logs interface IP addresses; keep logs IP-free.
    listenTextResolver: () => `listening on port ${config.port}`,
  });
}

main().catch((err: unknown) => {
  // Config errors are already readable; anything else prints the stack.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
