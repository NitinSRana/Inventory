import { defineConfig } from 'drizzle-kit';

// Next.js reads .env.local; drizzle-kit does not. Node 20.6+ can load it directly.
try {
  process.loadEnvFile('.env.local');
} catch {
  // Not present in CI — DATABASE_URL is expected from the real environment.
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
