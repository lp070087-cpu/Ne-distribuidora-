let pool;

export async function database() {
  const connectionString = process.env.MAXDISTRIB_DATABASE_URL;
  if (!connectionString) throw new Error('MAXDISTRIB_DATABASE_URL ausente');
  if (!pool) {
    const { default: pg } = await import('pg');
    pool ??= new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
    pool.on('error', error => console.error('maxdistrib pool', error.code || error.name));
  }
  return pool;
}

export async function transaction(pool, run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const rows = async (db, sql, values = []) => (await db.query(sql, values)).rows;
export const first = async (db, sql, values = []) => (await rows(db, sql, values))[0];
