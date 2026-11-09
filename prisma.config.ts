import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL is read here for CLI commands (migrate); the runtime reads it via config.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
