import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { first } from './db.js';
import { RETAIL, WHOLESALE, requireValue, email, field, phone, state, taxId } from './rules.js';
const derive = promisify(scrypt);
const cookieName = 'maxdistrib_session';
const sessionSeconds = 7 * 86400;
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const isToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function passwordHash(password) {
  requireValue(typeof password === 'string' && password.length >= 12 && password.length <= 128, 'Use uma senha de 12 a 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, key] = (stored || '00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
  const result = await derive(password, salt, 64);
  return Boolean(stored) && timingSafeEqual(result, Buffer.from(key,'hex'));
}
export function sessionToken(request) {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)maxdistrib_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
}
export function cookie(value, secure) {
  return cookieName + '=' + (value || '') + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' +
    (value ? sessionSeconds : 0) + (secure ? '; Secure' : '');
}
export async function issueSession(db, id) {
  const secret = token();
  await db.query("INSERT INTO maxdistrib.sessions VALUES ($1,$2,now()+interval '7 days')", [hash(secret),id]);
  return secret;
}
export async function currentAccount(db, request, lock = false) {
  const secret = sessionToken(request);
  if (!secret) return null;
  const account = await first(db,`SELECT a.* FROM maxdistrib.accounts a JOIN maxdistrib.sessions s ON s.account_id=a.id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND a.status<>'SUSPENDED'${lock ? ' FOR UPDATE OF a' : ''}`, [hash(secret)]);
  if (lock && account && !await first(db,'SELECT token_hash FROM maxdistrib.sessions WHERE token_hash=$1 AND expires_at>now()',[hash(secret)])) return null;
  return account;
}
export function accountView(account) {
  const {id, name, email, phone, role, status, business, tax_id, city, state, deletion_requested_at} = account;
  return {id,name,email,phone,role,status,business,tax_id,city,state,deletion_requested_at};
}
export function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function configuration(env) {
  return { enabled:env.MAXDISTRIB_PORTAL_ENABLED === '1' && !!env.MAXDISTRIB_DATABASE_URL,
    terms:safeUrl(env.MAXDISTRIB_TERMS_URL), privacy:safeUrl(env.MAXDISTRIB_PRIVACY_URL),
    termsVersion:env.MAXDISTRIB_TERMS_VERSION || null,
    contact:safeUrl(env.MAXDISTRIB_WHATSAPP_URL), support: 'https://www.nedistribuidora.com.br/',
    recovery:Boolean(env.MAXDISTRIB_RESEND_KEY && env.MAXDISTRIB_EMAIL_FROM && safeUrl(env.MAXDISTRIB_ORIGIN)),
    deliveryQuote:env.MAXDISTRIB_DELIVERY_QUOTE === '1' };
}
export async function rateLimit(db, bucket, limit) {
  const window = Math.floor(Date.now() / 900000);
  const {hits} = await first(db,`INSERT INTO maxdistrib.rate_limits(bucket,window_start) VALUES($1,$2)
    ON CONFLICT(bucket,window_start) DO UPDATE SET hits=maxdistrib.rate_limits.hits+1 RETURNING hits`, [hash(bucket),window]);
  requireValue(hits <= limit, 'Muitas tentativas. Aguarde 15 minutos.', 429);
}
export async function register(db, data, config) {
  requireValue(config.terms && config.privacy && config.termsVersion, 'Cadastro temporariamente indisponível.', 503);
  requireValue(data.accepted === true && data.termsVersion === config.termsVersion, 'Aceite os termos e a política atualizados.');
  requireValue(data.password === data.confirmPassword, 'As senhas precisam ser iguais.');
  requireValue([RETAIL,WHOLESALE].includes(data.role), 'Escolha um perfil comercial.');
  const reseller = data.role === WHOLESALE;
  const id = randomUUID();
  await db.query(`INSERT INTO maxdistrib.accounts (id,email,password_hash,name,phone,role,status,business,tax_id,city,state,accepted_terms)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id,email(data.email),await passwordHash(data.password),
    field(data.name,'Nome',120,2),phone(data.phone),data.role,reseller?'PENDING_APPROVAL':'ACTIVE',
    reseller?field(data.business,'Nome comercial'):null,reseller?taxId(data.taxId):null,
    reseller?field(data.city,'Cidade'):null,reseller?state(data.state):null,config.termsVersion]);
  return issueSession(db,id);
}
export async function resetEmail(pool, account, env) {
  const secret = token();
  const link = new URL('/minha-conta#recuperar=' + secret, env.MAXDISTRIB_ORIGIN);
  await pool.query("INSERT INTO maxdistrib.password_resets VALUES($1,$2,now()+interval '30 minutes')", [hash(secret),account.id]);
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST', signal:AbortSignal.timeout(7000),
    headers:{ Authorization:'Bearer '+env.MAXDISTRIB_RESEND_KEY,'Content-Type':'application/json' },
    body:JSON.stringify({ from:env.MAXDISTRIB_EMAIL_FROM,to:[account.email],subject:'Recupere sua senha da NE Distribuidora',
      text:'Abra o link em até 30 minutos para definir uma nova senha: '+link.href })
  });
  if (!response.ok) {
    await pool.query('DELETE FROM maxdistrib.password_resets WHERE token_hash=$1',[hash(secret)]);
    throw new Error('Falha no provedor de recuperação');
  }
}
