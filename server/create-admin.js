import { randomUUID } from 'node:crypto';
import { database } from './db.js';
import { email, field, phone } from './rules.js';
import { passwordHash } from './auth.js';
const pool = await database();
try {
  await pool.query(`INSERT INTO maxdistrib.accounts(id,email,password_hash,name,phone,role,status,accepted_terms)
    VALUES($1,$2,$3,$4,$5,'ADMIN','ACTIVE','ADMIN_PROVISIONED')`,[randomUUID(),email(process.env.MAXDISTRIB_ADMIN_EMAIL),
    await passwordHash(process.env.MAXDISTRIB_ADMIN_PASSWORD),field(process.env.MAXDISTRIB_ADMIN_NAME,'Nome'),
    phone(process.env.MAXDISTRIB_ADMIN_PHONE)]);
  console.log('Conta administrativa criada.');
} finally { await pool.end(); }
