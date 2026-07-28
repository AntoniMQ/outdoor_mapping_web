/**
 * Applies the SQL migrations in ./drizzle in filename order.
 * Usage: pnpm db:migrate  (requires DATABASE_URL)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  await sql`CREATE TABLE IF NOT EXISTS _trailloop_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;

  const directory = join(process.cwd(), 'drizzle');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const applied = await sql`SELECT 1 FROM _trailloop_migrations WHERE name = ${file}`;
    if (applied.length > 0) {
      console.warn(`skip ${file} (already applied)`);
      continue;
    }
    const contents = await readFile(join(directory, file), 'utf8');
    await sql.unsafe(contents);
    await sql`INSERT INTO _trailloop_migrations (name) VALUES (${file})`;
    console.warn(`applied ${file}`);
  }

  await sql.end();
  console.warn('Migrations complete.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
