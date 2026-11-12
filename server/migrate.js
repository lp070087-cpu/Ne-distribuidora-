import { readFile, readdir } from 'node:fs/promises';
import { database, transaction, first } from './db.js';
const pool = await database();
try {
  await transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('maxdistrib-migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS maxdistrib');
    await db.query('CREATE TABLE IF NOT EXISTS maxdistrib.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('./migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()) {
      if (await first(db, 'SELECT name FROM maxdistrib.migrations WHERE name=$1', [name])) continue;
      await db.query(await readFile(new URL(name, directory), 'utf8'));
      await db.query('INSERT INTO maxdistrib.migrations(name) VALUES($1)', [name]);
      console.log('Migração aplicada:', name);
    }
  });
} finally {
  await pool.end();
}
