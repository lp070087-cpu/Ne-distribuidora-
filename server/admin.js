import { first, rows } from './db.js';
import { field, imagePath, integer, requireValue, uuid, WHOLESALE } from './rules.js';
import { detail, updateOrder } from './orders.js';

export async function adminAction(db, account, action, data) {
  if (action === 'admin.dashboard') {
    const search = '%' + field(data.search,'Busca',100,0) + '%';
    const status = field(data.status,'Status',40,0);
    const accounts = await rows(db,`SELECT id,email,name,business,role,status,created_at,deletion_requested_at
      FROM maxdistrib.accounts WHERE role<>'ADMIN' AND (name ILIKE $1 OR email ILIKE $1 OR business ILIKE $1)
      AND ($2='' OR status=$2) ORDER BY created_at DESC LIMIT 100`,[search,status]);
    const orders = await rows(db,`SELECT o.id,o.code,o.status,o.subtotal_cents,o.created_at,o.cancellation_requested_at,a.name
      FROM maxdistrib.orders o JOIN maxdistrib.accounts a ON a.id=o.account_id
      WHERE (o.code ILIKE $1 OR a.name ILIKE $1 OR a.email ILIKE $1) AND ($2='' OR o.status=$2)
      ORDER BY o.created_at DESC LIMIT 100`,[search,status]);
    const products = await rows(db,`SELECT * FROM maxdistrib.products WHERE name ILIKE $1 OR sku ILIKE $1 ORDER BY name LIMIT 250`,[search]);
    const support = await rows(db,`SELECT s.id,s.message,s.created_at,a.email,a.name,o.code
      FROM maxdistrib.support s JOIN maxdistrib.accounts a ON a.id=s.account_id
      LEFT JOIN maxdistrib.orders o ON o.id=s.order_id ORDER BY s.created_at DESC LIMIT 50`);
    const stock = await rows(db,`SELECT sku,event,on_hand_delta,reserved_delta,created_at FROM maxdistrib.stock_events ORDER BY id DESC LIMIT 100`);
    return {accounts,orders,products,support,stock};
  }
  if (action === 'admin.account') {
    const id = uuid(data.id);
    const customer = await first(db,`SELECT id,email,name,phone,business,tax_id,city,state,role,status,created_at,deletion_requested_at
      FROM maxdistrib.accounts WHERE id=$1 AND role<>'ADMIN'`,[id]);
    requireValue(customer,'Conta não encontrada.',404);
    const orders = await rows(db,'SELECT id,code,status,subtotal_cents,created_at FROM maxdistrib.orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',[id]);
    return {customer,orders};
  }
  if (action === 'admin.accountStatus') {
    const id = uuid(data.id);
    const status = field(data.status,'Status',40);
    const customer = await first(db,"SELECT role FROM maxdistrib.accounts WHERE id=$1 AND role<>'ADMIN' FOR UPDATE",[id]);
    requireValue(customer,'Conta não encontrada.',404);
    requireValue(['ACTIVE','SUSPENDED', ...(customer.role===WHOLESALE?['REJECTED','PENDING_APPROVAL']:[])].includes(status),'Status inválido.');
    await db.query('UPDATE maxdistrib.accounts SET status=$2 WHERE id=$1',[id,status]);
    if (status === 'SUSPENDED') await db.query('DELETE FROM maxdistrib.sessions WHERE account_id=$1',[id]);
    return {ok:true};
  }
  if (action === 'admin.order') return detail(db,uuid(data.id));
  if (action === 'admin.orderStatus') return updateOrder(db,account,data);
  if (action === 'admin.note') {
    await detail(db,uuid(data.id));
    await db.query('INSERT INTO maxdistrib.order_notes(order_id,actor_id,message) VALUES($1,$2,$3)',
      [uuid(data.id),account.id,field(data.message,'Observação',2000)]);
    return detail(db,uuid(data.id));
  }
  requireValue(action === 'admin.product','Ação desconhecida.',404);
  const sku = field(data.sku,'SKU',100);
  const name = field(data.name,'Nome');
  const category = field(data.category,'Categoria');
  const brand = field(data.brand,'Marca');
  const image = imagePath(data.image);
  const retail = data.retail_cents === null ? null : integer(data.retail_cents,1,100000000,'Preço de varejo');
  const multiple = integer(data.multiple,1,10000,'Múltiplo');
  requireValue(Array.isArray(data.tiers) && data.tiers.length<=12,'Faixas de atacado inválidas.');
  const tiers = data.tiers.map(t => {
    requireValue(t && typeof t === 'object','Faixa inválida.');
    const minimum = integer(t.minimum,multiple,10000,'Quantidade mínima');
    requireValue(minimum % multiple === 0,'O mínimo precisa respeitar o múltiplo.');
    return {minimum,cents:integer(t.cents,1,100000000,'Preço por faixa')};
  }).sort((a,b) => a.minimum-b.minimum);
  requireValue(tiers.every((t,i)=>!i || t.minimum>tiers[i-1].minimum && t.cents<=tiers[i-1].cents),
    'Use faixas distintas e preços progressivos.');
  const until = data.until ? new Date(data.until) : null;
  requireValue(!until || Number.isFinite(+until),'Validade inválida.');
  const stock = data.stockDelta == null ? 0 : integer(data.stockDelta,-1000000,1000000,'Ajuste de estoque');
  await db.query(`INSERT INTO maxdistrib.products(sku,name,category,brand,image,retail_cents,wholesale_tiers,wholesale_multiple,wholesale_until,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(sku) DO UPDATE SET name=excluded.name, category=excluded.category,
    brand=excluded.brand,image=excluded.image,retail_cents=excluded.retail_cents,wholesale_tiers=excluded.wholesale_tiers,
    wholesale_multiple=excluded.wholesale_multiple,wholesale_until=excluded.wholesale_until,active=excluded.active`,
    [sku,name,category,brand,image,retail,JSON.stringify(tiers),multiple,until,data.active===true]);
  if (stock) {
    const updated = await first(db,'UPDATE maxdistrib.products SET on_hand=on_hand+$2 WHERE sku=$1 AND on_hand+$2>=reserved RETURNING sku',[sku,stock]);
    requireValue(updated,'O ajuste deixa o saldo abaixo das reservas.',409);
    await db.query(`INSERT INTO maxdistrib.stock_events(sku,actor_id,event,on_hand_delta,reserved_delta)
      VALUES($1,$2,'ADJUSTED',$3,0)`,[sku,account.id,stock]);
  }
  return first(db,'SELECT * FROM maxdistrib.products WHERE sku=$1',[sku]);
}
