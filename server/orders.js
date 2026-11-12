import { randomUUID, randomBytes } from 'node:crypto';
import { first, rows } from './db.js';
import { hash } from './auth.js';
import { quote, stockEffect, requireValue, integer, uuid, field, productView } from './rules.js';

export async function cart(db, account, lock = false) {
  const products = await rows(db,`SELECT p.*, c.quantity FROM maxdistrib.cart c JOIN maxdistrib.products p ON p.sku=c.sku
    WHERE c.account_id=$1 ORDER BY p.sku${lock ? ' FOR UPDATE OF p' : ''}`,[account.id]);
  const items = products.map(p => {
    const item = {...productView(p, account), quantity:p.quantity};
    try { return {...item, unit_cents:quote(p,account,p.quantity), error:null}; }
    catch (error) { if (!error.status) throw error; return {...item, unit_cents:null, error:error.message}; }
  });
  return {items, subtotal:items.reduce((sum,item) => sum + item.quantity * (item.unit_cents ?? 0),0)};
}
export async function setCart(db, account, data) {
  const sku = field(data.sku,'SKU',100);
  let quantity = integer(data.quantity, data.add === true ? 1 : 0, 10000, 'Quantidade');
  if (data.add === true) {
    const existing = await first(db,'SELECT quantity FROM maxdistrib.cart WHERE account_id=$1 AND sku=$2',[account.id,sku]);
    quantity += existing?.quantity ?? 0;
  }
  if (!quantity) {
    await db.query('DELETE FROM maxdistrib.cart WHERE account_id=$1 AND sku=$2',[account.id,sku]);
    return;
  }
  const product = await first(db,'SELECT * FROM maxdistrib.products WHERE sku=$1',[sku]);
  requireValue(product,'Produto indisponível.',404);
  quote(product,account,quantity);
  await db.query(`INSERT INTO maxdistrib.cart VALUES($1,$2,$3) ON CONFLICT(account_id,sku)
    DO UPDATE SET quantity=excluded.quantity`,[account.id,sku,quantity]);
}
export async function detail(db, id, owner = null) {
  const order = await first(db,`SELECT id,code,account_id,role,status,address,subtotal_cents,created_at,cancellation_requested_at
    FROM maxdistrib.orders WHERE id=$1 AND ($2::uuid IS NULL OR account_id=$2)`,[id,owner]);
  requireValue(order,'Pedido não encontrado.',404);
  const items = await rows(db,'SELECT sku,name,quantity,unit_cents FROM maxdistrib.order_items WHERE order_id=$1 ORDER BY sku',[id]);
  const events = await rows(db,'SELECT status,created_at FROM maxdistrib.order_events WHERE order_id=$1 ORDER BY seq',[id]);
  const notes = owner ? undefined : await rows(db,'SELECT message,created_at FROM maxdistrib.order_notes WHERE order_id=$1 ORDER BY id',[id]);
  return {...order,items,events,notes};
}
export async function event(db, id, actor, status) {
  await db.query('INSERT INTO maxdistrib.order_events(order_id,actor_id,status) VALUES($1,$2,$3)',[id,actor,status]);
}
export async function checkout(db, account, data, config) {
  const key = uuid(data.key);
  const addressId = uuid(data.addressId);
  const expectedSubtotal = integer(data.subtotal,1,Number.MAX_SAFE_INTEGER,'Subtotal');
  requireValue(Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 100,
    'Itens de revisão inválidos.');
  const reviewed = data.items.map(item => {
    requireValue(item && typeof item === 'object','Item de revisão inválido.');
    return [field(item.sku,'SKU',100),integer(item.quantity,1,10000,'Quantidade'),
      integer(item.unit_cents,1,100000000,'Preço')];
  });
  const fingerprint = hash(JSON.stringify([addressId,expectedSubtotal,reviewed]));
  const existing = await first(db,'SELECT id,request_hash FROM maxdistrib.orders WHERE account_id=$1 AND idempotency_key=$2',[account.id,key]);
  if (existing) {
    requireValue(existing.request_hash === fingerprint,'Esta chave já foi usada para outra solicitação.',409);
    return detail(db,existing.id,account.id);
  }
  requireValue(config.deliveryQuote,'Entrega ainda não configurada.',503);
  const selected = await first(db,'SELECT details FROM maxdistrib.addresses WHERE account_id=$1 AND id=$2',[account.id,addressId]);
  requireValue(selected,'Selecione um endereço da sua conta.',404);
  const current = await cart(db,account,true);
  requireValue(current.items.length && current.items.length <= 100 && !current.items.some(item => item.error),
    'Revise a disponibilidade e as quantidades no carrinho.',409);
  const actual = current.items.map(item => [item.sku,item.quantity,item.unit_cents]);
  requireValue(expectedSubtotal === current.subtotal && JSON.stringify(actual) === JSON.stringify(reviewed),
    'O carrinho mudou. Revise os itens e valores antes de confirmar.',409);
  const id = randomUUID();
  const code = 'NE-' + randomBytes(8).toString('hex').toUpperCase();
  await db.query(`INSERT INTO maxdistrib.orders(id,code,account_id,idempotency_key,request_hash,role,status,address,subtotal_cents)
    VALUES($1,$2,$3,$4,$5,$6,'RECEIVED',$7,$8)`,[id,code,account.id,key,fingerprint,account.role,selected.details,current.subtotal]);
  for (const item of current.items) {
    await db.query('INSERT INTO maxdistrib.order_items VALUES($1,$2,$3,$4,$5)',[id,item.sku,item.name,item.quantity,item.unit_cents]);
  }
  await event(db,id,account.id,'RECEIVED');
  await db.query('DELETE FROM maxdistrib.cart WHERE account_id=$1',[account.id]);
  return detail(db,id,account.id);
}
export async function updateOrder(db, admin, data) {
  const id = uuid(data.id);
  const order = await first(db,'SELECT id,status FROM maxdistrib.orders WHERE id=$1 FOR UPDATE',[id]);
  requireValue(order,'Pedido não encontrado.',404);
  const next = field(data.status,'Status',40);
  if (next === order.status) return detail(db,id);
  const items = await rows(db,'SELECT sku,quantity FROM maxdistrib.order_items WHERE order_id=$1 ORDER BY sku',[id]);
  requireValue(items.length,'Pedido sem itens.',409);
  for (const item of items) {
    const effect = stockEffect(order.status,next,item.quantity);
    if (!effect) continue;
    const [kind,onHand,reserved] = effect;
    const updated = await first(db,`UPDATE maxdistrib.products SET on_hand=on_hand+$2,reserved=reserved+$3
      WHERE sku=$1 AND reserved+$3 BETWEEN 0 AND on_hand+$2 AND ($3<=0 OR active) RETURNING sku`,
      [item.sku,onHand,reserved]);
    requireValue(updated,'Saldo insuficiente para movimentar ' + item.sku + '.',409);
    await db.query(`INSERT INTO maxdistrib.stock_events(sku,order_id,actor_id,event,on_hand_delta,reserved_delta)
      VALUES($1,$2,$3,$4,$5,$6)`,[item.sku,id,admin.id,kind,onHand,reserved]);
  }
  await db.query('UPDATE maxdistrib.orders SET status=$2 WHERE id=$1',[id,next]);
  await event(db,id,admin.id,next);
  return detail(db,id);
}
