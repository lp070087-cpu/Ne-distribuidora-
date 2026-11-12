import { randomUUID } from 'node:crypto';
import { database, transaction, first, rows } from '../server/db.js';
import { RETAIL, WHOLESALE, field, email, phone, address, uuid, productView, requireValue, integer } from '../server/rules.js';
import { configuration, register, accountView, cookie, currentAccount, hash, isToken, issueSession,
  passwordHash, rateLimit, resetEmail, sessionToken, verifyPassword } from '../server/auth.js';
import { cart, setCart, checkout, detail } from '../server/orders.js';
import { adminAction } from '../server/admin.js';

async function payload(request) {
  requireValue(request.headers.get('content-type')?.split(';')[0] === 'application/json','Formato inválido.',415);
  const reader = request.body?.getReader();
  requireValue(reader,'Conteúdo ausente.');
  const decoder = new TextDecoder('utf-8',{fatal:true});
  let text = '', length = 0;
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      length += value.length;
      requireValue(length<=65536,'Solicitação muito grande.',413);
      text += decoder.decode(value,{stream:true});
    }
    const result = JSON.parse(text + decoder.decode());
    requireValue(result && typeof result === 'object' && !Array.isArray(result),'Conteúdo inválido.');
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    requireValue(false,error.status ? error.message : 'JSON inválido.',error.status || 400);
  }
}

function reply(body,status=200,session) {
  const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if (session !== undefined) headers['Set-Cookie'] = cookie(session,process.env.NODE_ENV!=='test' && process.env.NODE_ENV!=='development');
  return Response.json(body,{status,headers});
}

async function addressAction(db, account, action, data) {
  if (action === 'addresses') return rows(db,`SELECT id,details,is_primary FROM maxdistrib.addresses
    WHERE account_id=$1 ORDER BY is_primary DESC,id`,[account.id]);
  const id = data.id ? uuid(data.id) : randomUUID();
  if (action === 'address.delete') {
    const deleted = await first(db,'DELETE FROM maxdistrib.addresses WHERE id=$1 AND account_id=$2 RETURNING is_primary',[id,account.id]);
    requireValue(deleted,'Endereço não encontrado.',404);
    if (deleted.is_primary) await db.query(`UPDATE maxdistrib.addresses SET is_primary=true
      WHERE id=(SELECT id FROM maxdistrib.addresses WHERE account_id=$1 ORDER BY id LIMIT 1)`,[account.id]);
    return {ok:true};
  }
  requireValue(action === 'address.save','Ação desconhecida.',404);
  const existing = data.id ? await first(db,'SELECT is_primary FROM maxdistrib.addresses WHERE id=$1 AND account_id=$2',[id,account.id]) : null;
  requireValue(!data.id || existing,'Endereço não encontrado.',404);
  const count = await first(db,'SELECT count(*)::int AS total FROM maxdistrib.addresses WHERE account_id=$1',[account.id]);
  requireValue(existing || count.total<25,'Limite de endereços atingido.',409);
  const primary = data.primary === true || existing?.is_primary === true || count.total === 0;
  if (primary) await db.query('UPDATE maxdistrib.addresses SET is_primary=false WHERE account_id=$1 AND is_primary',[account.id]);
  const details = address(data);
  if (existing) await db.query('UPDATE maxdistrib.addresses SET details=$3,is_primary=$4 WHERE id=$1 AND account_id=$2',[id,account.id,details,primary]);
  else await db.query('INSERT INTO maxdistrib.addresses VALUES($1,$2,$3,$4)',[id,account.id,details,primary]);
  return {id};
}

async function catalog(db, account, data) {
    const term = '%' + field(data.search,'Busca',100,0) + '%';
    const category = field(data.category,'Categoria',120,0);
    const list = await rows(db,`SELECT * FROM maxdistrib.products WHERE active AND (name ILIKE $1 OR category ILIKE $1 OR brand ILIKE $1 OR sku ILIKE $1)
      AND ($2='' OR category=$2) ORDER BY name,sku LIMIT 250`,[term,category]);
    return list.map(product => productView(product,account));
}

async function customerAction(db, account, action, data, config, request) {
  const id = account.id;
  if (action === 'overview') {
    const counts = await first(db,`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='DELIVERED')::int AS completed,
      count(*) FILTER(WHERE status NOT IN ('DELIVERED','CANCELLED'))::int AS pending,
      COALESCE(sum(subtotal_cents) FILTER(WHERE status='DELIVERED' AND created_at>=date_trunc('month',now())),0)::text AS month_total
      FROM maxdistrib.orders WHERE account_id=$1`,[id]);
    const favorites = await first(db,'SELECT count(*)::int AS total FROM maxdistrib.favorites WHERE account_id=$1',[id]);
    const recent = await rows(db,`SELECT id,code,status,created_at FROM maxdistrib.orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 4`,[id]);
    const frequent = await rows(db,`SELECT i.sku,i.name,sum(i.quantity) AS quantity FROM maxdistrib.order_items i
      JOIN maxdistrib.orders o ON o.id=i.order_id WHERE o.account_id=$1 AND o.status='DELIVERED'
      GROUP BY i.sku,i.name ORDER BY quantity DESC LIMIT 4`,[id]);
    return {counts,favorites:favorites.total,recent,frequent};
  }
  if (action === 'catalog') return catalog(db,account,data);
  if (action === 'cart.import') {
    requireValue(Array.isArray(data.items) && data.items.length <= 100, 'Seleção inválida.');
    const ignored = [];
    for (const item of data.items) {
      requireValue(item && typeof item === 'object','Item inválido.');
      const sku = field(item.sku,'SKU',100);
      const quantity = integer(item.quantity,1,10000,'Quantidade');
      const present = await first(db,'SELECT quantity FROM maxdistrib.cart WHERE account_id=$1 AND sku=$2',[id,sku]);
      if (present?.quantity >= quantity) continue;
      try { await setCart(db,account,{sku,quantity}); }
      catch (error) {
        if (!error.status) throw error;
        ignored.push(sku);
      }
    }
    return {ignored};
  }
  if (action === 'cart') return cart(db,account);
  if (action === 'cart.set') { await setCart(db,account,data); return cart(db,account); }
  if (action === 'cart.clear') { await db.query('DELETE FROM maxdistrib.cart WHERE account_id=$1',[id]); return {ok:true}; }
  if (action === 'checkout') return checkout(db,account,data,config);
  if (action === 'orders') return rows(db,`SELECT id,code,status,subtotal_cents,created_at,cancellation_requested_at FROM maxdistrib.orders
    WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100`,[id]);
  if (['order','order.reorder','order.cancel'].includes(action)) {
    const order = await detail(db,uuid(data.id),id);
    if (action === 'order.reorder') {
      for (const item of order.items) await setCart(db,account,{sku:item.sku,quantity:item.quantity,add:true});
      return cart(db,account);
    }
    if (action === 'order.cancel') {
      const updated = await first(db,`UPDATE maxdistrib.orders SET cancellation_requested_at=COALESCE(cancellation_requested_at,now())
        WHERE id=$1 AND account_id=$2 AND status IN ('RECEIVED','AWAITING_CONFIRMATION','CONFIRMED','PICKING') RETURNING id`,[order.id,id]);
      requireValue(updated,'Este pedido não aceita solicitação de cancelamento.',409);
      return detail(db,order.id,id);
    }
    return order;
  }
  if (action === 'favorites') {
    const list = await rows(db,`SELECT p.* FROM maxdistrib.favorites f JOIN maxdistrib.products p ON p.sku=f.sku
      WHERE f.account_id=$1 ORDER BY p.name`,[id]);
    return list.map(product => productView(product,account));
  }
  if (action === 'favorite.set') {
    const sku = field(data.sku,'SKU',100);
    if (data.saved === true) {
      const product = await first(db,'SELECT sku FROM maxdistrib.products WHERE sku=$1 AND active',[sku]);
      requireValue(product,'Produto não encontrado.',404);
      await db.query('INSERT INTO maxdistrib.favorites VALUES($1,$2) ON CONFLICT DO NOTHING',[id,sku]);
    } else await db.query('DELETE FROM maxdistrib.favorites WHERE account_id=$1 AND sku=$2',[id,sku]);
    return {ok:true};
  }
  if (['addresses','address.save','address.delete'].includes(action)) return addressAction(db,account,action,data);
  if (action === 'profile') {
    await db.query('UPDATE maxdistrib.accounts SET name=$2,phone=$3 WHERE id=$1',[id,field(data.name,'Nome',120,2),phone(data.phone)]);
    return accountView(await first(db,'SELECT * FROM maxdistrib.accounts WHERE id=$1',[id]));
  }
  if (action === 'support') {
    const order = data.id ? await detail(db,uuid(data.id),id) : null;
    await db.query('INSERT INTO maxdistrib.support(id,account_id,order_id,message) VALUES($1,$2,$3,$4)',
      [randomUUID(),id,order?.id||null,field(data.message,'Mensagem',2000,8)]);
    return {ok:true};
  }
  if (['password.change','sessions.revoke','account.delete'].includes(action)) {
    requireValue(await verifyPassword(data.currentPassword,account.password_hash),'Senha atual incorreta.',403);
    if (action === 'password.change') {
      requireValue(data.password === data.confirmPassword,'As senhas precisam ser iguais.');
      await db.query('UPDATE maxdistrib.accounts SET password_hash=$2 WHERE id=$1',[id,await passwordHash(data.password)]);
      await db.query('DELETE FROM maxdistrib.password_resets WHERE account_id=$1',[id]);
    }
    if (action === 'account.delete') await db.query(`UPDATE maxdistrib.accounts SET deletion_requested_at=COALESCE(deletion_requested_at,now()) WHERE id=$1`,[id]);
    else await db.query('DELETE FROM maxdistrib.sessions WHERE account_id=$1 AND token_hash<>$2',[id,hash(sessionToken(request))]);
    return {ok:true};
  }
  requireValue(false,'Ação desconhecida.',404);
}

export default async function handler(request) {
  const env = process.env;
  const config = configuration(env);
  try {
    if (request.method === 'GET') return reply(config);
    requireValue(request.method==='POST','Método indisponível.',405);
    const origin = request.headers.get('origin');
    const allowed = env.MAXDISTRIB_ORIGIN ? new URL(env.MAXDISTRIB_ORIGIN).origin : new URL(request.url).origin;
    requireValue(origin === allowed && request.headers.get('sec-fetch-site') !== 'cross-site','Origem inválida.',403);
    requireValue(config.enabled,'Portal temporariamente indisponível.',503);
    const data = await payload(request);
    const action = field(data.action,'Ação',45);
    const pool = await database();
    if (action === 'catalog.public') return reply(await catalog(pool,{role:RETAIL,status:'ACTIVE'},data));
    if (action === 'session') {
      const account = await currentAccount(pool,request);
      return reply({account:account ? accountView(account) : null});
    }
    if (action === 'logout') {
      const secret = sessionToken(request);
      if (secret) await pool.query('DELETE FROM maxdistrib.sessions WHERE token_hash=$1',[hash(secret)]);
      return reply({ok:true},200,'');
    }
    const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim() || 'local';
    if (['register','login','password.forgot','password.reset'].includes(action)) {
      await rateLimit(pool, action+':ip:'+ip, action==='login' ? 40 : 20);
      if (action !== 'password.reset') await rateLimit(pool,action+':email:'+email(data.email),action==='login'?10:5);
    }
    if (action === 'register') {
      const secret = await transaction(pool,db=>register(db,data,config));
      return reply({ok:true},201,secret);
    }
    if (action === 'login') {
      const secret = await transaction(pool,async db=>{
        const account = await first(db,'SELECT * FROM maxdistrib.accounts WHERE email=$1 FOR UPDATE',[email(data.email)]);
        const valid = await verifyPassword(data.password,account?.password_hash);
        requireValue(valid && account.status !== 'SUSPENDED','E-mail ou senha inválidos.',401);
        return issueSession(db,account.id);
      });
      return reply({ok:true},200,secret);
    }
    if (action === 'password.forgot') {
      requireValue(config.recovery,'Recuperação por e-mail indisponível. Consulte o atendimento.',503);
      const account = await first(pool,"SELECT id,email FROM maxdistrib.accounts WHERE email=$1 AND status<>'SUSPENDED'",[email(data.email)]);
      if (account) await resetEmail(pool,account,env).catch(error=>console.error('maxdistrib recovery',error.name));
      return reply({ok:true});
    }
    if (action === 'password.reset') {
      requireValue(isToken(data.token) && data.password === data.confirmPassword,'Link ou confirmação inválida.');
      await transaction(pool,async db=>{
        const digest = hash(data.token);
        const candidate = await first(db,'SELECT account_id FROM maxdistrib.password_resets WHERE token_hash=$1 AND expires_at>now()',[digest]);
        requireValue(candidate,'Link inválido ou expirado.',400);
        const account = await first(db,'SELECT status FROM maxdistrib.accounts WHERE id=$1 FOR UPDATE',[candidate.account_id]);
        requireValue(account.status!=='SUSPENDED','Link inválido ou expirado.',400);
        const consumed = await first(db,'DELETE FROM maxdistrib.password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING account_id',[digest]);
        requireValue(consumed,'Link inválido ou expirado.',400);
        await db.query('UPDATE maxdistrib.accounts SET password_hash=$2 WHERE id=$1',[candidate.account_id,await passwordHash(data.password)]);
        await db.query('DELETE FROM maxdistrib.password_resets WHERE account_id=$1',[candidate.account_id]);
        await db.query('DELETE FROM maxdistrib.sessions WHERE account_id=$1',[candidate.account_id]);
      });
      return reply({ok:true},200,'');
    }
    if (['password.change','sessions.revoke','account.delete','support'].includes(action)) {
      const account = await currentAccount(pool,request);
      requireValue(account,'Entre novamente para continuar.',401);
      await rateLimit(pool,action+':account:'+account.id,8);
    }
    const value = await transaction(pool,async db=>{
      const account = await currentAccount(db,request,true);
      requireValue(account,'Entre novamente para continuar.',401);
      if (action.startsWith('admin.')) {
        requireValue(account.role==='ADMIN','Acesso administrativo necessário.',403);
        return adminAction(db,account,action,data);
      }
      requireValue([RETAIL,WHOLESALE].includes(account.role),'Acesso restrito à conta de compras.',403);
      return customerAction(db,account,action,data,config,request);
    });
    return reply(value);
  } catch (error) {
    if (error.status) return reply({error:error.message},error.status);
    if (error.code==='23505') return reply({error:'Já existe um registro com estes dados.'},409);
    console.error('maxdistrib portal',error.code || error.name);
    return reply({error:'A operação não pôde ser concluída. Tente novamente.'},503);
  }
}
