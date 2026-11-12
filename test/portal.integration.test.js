import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import handler from '../api/portal.js';
import { database } from '../server/db.js';
import { hash, passwordHash, token } from '../server/auth.js';

const enabled = process.env.MAXDISTRIB_TEST_DB === '1';
const origin = 'https://portal.test';
const addr = {zip:'50000-000',street:'Rua de Teste',number:'12',district:'Centro',city:'Recife',state:'PE'};
const password = 'isolated-fixture-password-1';
function client() {
  let session = '';
  return async (action, data={}, status=200) => {
    const response = await handler(new Request(origin+'/api/portal',{method:'POST',
      headers:{origin,'Content-Type':'application/json',cookie:session},body:JSON.stringify({...data,action})}));
    const value = await response.json();
    assert.equal(response.status,status,action+' '+JSON.stringify(value));
    const cookie = response.headers.get('set-cookie');
    if (cookie) session=cookie.split(';')[0];
    return value;
  };
}
test('isolated PostgreSQL: retail, wholesale, session boundaries, orders and concurrent stock', {skip:!enabled}, async t => {
  const url = new URL(process.env.MAXDISTRIB_DATABASE_URL);
  assert.equal(url.hostname,'localhost');
  assert.equal(url.pathname,'/maxdistrib_test');
  Object.assign(process.env,{
    MAXDISTRIB_PORTAL_ENABLED:'1', MAXDISTRIB_TERMS_URL:origin+'/termos',
    MAXDISTRIB_PRIVACY_URL:origin+'/privacidade',MAXDISTRIB_TERMS_VERSION:'fixture',
    MAXDISTRIB_ORIGIN:origin,MAXDISTRIB_DELIVERY_QUOTE:'1'
  });
  const pool = await database();
  t.after(()=>pool.end());
  const suffix = randomUUID().slice(0,8);
  const adminEmail='admin-'+suffix+'@example.test';
  await pool.query(`INSERT INTO maxdistrib.accounts(id,email,password_hash,name,phone,role,status,accepted_terms)
    VALUES($1,$2,$3,'Admin Teste','81912345678','ADMIN','ACTIVE','FIXTURE')`,[randomUUID(),adminEmail,await passwordHash(password)]);
  const anonymous=client(), admin=client(), retail=client(), wholesale=client();
  await anonymous('cart',{},401);
  await admin('login',{email:adminEmail,password});
  const sku='TEST-'+suffix;
  await admin('admin.product',{sku,name:'Produto de teste isolado',brand:'Teste',category:'Proteínas',
    retail_cents:12000,multiple:4,tiers:[{minimum:4,cents:10000},{minimum:12,cents:9000}],active:true,stockDelta:12});
  const retailEmail='retail-'+suffix+'@example.test';
  const wholesaleEmail='wholesale-'+suffix+'@example.test';
  const registration={name:'Pessoa de Teste',phone:'81912345678',password,confirmPassword:password,accepted:true,termsVersion:'fixture'};
  await anonymous('register',{...registration,email:'bad-'+suffix+'@example.test',role:'ADMIN'},400);
  await retail('register',{...registration,email:retailEmail,role:'RETAIL_CUSTOMER'},201);
  await wholesale('register',{...registration,email:wholesaleEmail,role:'WHOLESALE_RESELLER',
    taxId:'04.252.011/0001-10',business:'Revenda teste',city:'Recife',state:'PE'},201);
  const reseller = (await wholesale('session')).account;
  const customer = (await retail('session')).account;
  assert.equal(reseller.status,'PENDING_APPROVAL');
  assert.equal((await retail('catalog',{search:sku,role:'ADMIN'}))[0].retail_cents,12000);
  assert.equal((await wholesale('catalog',{search:sku,status:'ACTIVE'}))[0].tiers,undefined);
  await wholesale('cart.set',{sku,quantity:4},403);
  await retail('admin.accountStatus',{id:reseller.id,status:'ACTIVE'},403);
  await admin('admin.accountStatus',{id:reseller.id,status:'ACTIVE'});
  assert.equal((await wholesale('catalog',{search:sku}))[0].tiers.length,2);
  assert.equal((await wholesale('cart.set',{sku,quantity:4,unit_cents:1})).subtotal,40000);
  assert.equal((await wholesale('cart.set',{sku,quantity:12})).subtotal,108000);
  await wholesale('cart.set',{sku,quantity:5},409);
  await wholesale('cart.set',{sku,quantity:16},409);
  assert.equal((await retail('cart.set',{sku,quantity:2})).subtotal,24000);
  assert.equal((await retail('cart.set',{sku,quantity:1})).subtotal,12000);
  assert.equal((await anonymous('catalog.public',{search:sku}))[0].tiers,undefined);
  const imported=await retail('cart.import',{items:[{sku,quantity:1},{sku:'missing',quantity:1}]});
  assert.deepEqual(imported.ignored,['missing']);
  await retail('cart.import',{items:[{sku,quantity:1}]});
  assert.equal((await retail('cart')).items[0].quantity,1);
  await retail('favorite.set',{sku,saved:true});
  await retail('logout');
  await retail('favorites',{},401);
  await retail('login',{email:retailEmail,password});
  assert.equal((await retail('favorites'))[0].sku,sku);
  assert.equal((await retail('cart')).items[0].quantity,1);
  const retailAddress = (await retail('address.save',addr)).id;
  const resellerAddress = (await wholesale('address.save',addr)).id;
  await wholesale('address.save',{...addr,id:retailAddress},404);
  await wholesale('address.delete',{id:retailAddress},404);
  const makeReview = async (client,addressId) => {
    const current = await client('cart');
    return {key:randomUUID(),addressId,subtotal:current.subtotal,items:current.items.map(({sku,quantity,unit_cents})=>({sku,quantity,unit_cents}))};
  };
  const retailReview = await makeReview(retail,retailAddress);
  const wholesaleReview = await makeReview(wholesale,resellerAddress);
  await retail('checkout',{...retailReview,subtotal:1},409);
  await retail('checkout',{...retailReview,addressId:resellerAddress},404);

  // Throw during the insert so the test can verify rollback of both the order and the cart.
  await pool.query(`CREATE FUNCTION maxdistrib.test_reject_event() RETURNS trigger LANGUAGE plpgsql
    AS $$BEGIN RAISE EXCEPTION 'isolated test rollback'; END;$$;
    CREATE TRIGGER test_reject_event BEFORE INSERT ON maxdistrib.order_events FOR EACH ROW EXECUTE FUNCTION maxdistrib.test_reject_event()`);
  try {
    await retail('checkout',retailReview,503);
    assert.deepEqual(await retail('orders'),[]);
    assert.equal((await retail('cart')).subtotal,12000);
  } finally {
    await pool.query('DROP TRIGGER test_reject_event ON maxdistrib.order_events; DROP FUNCTION maxdistrib.test_reject_event()');
  }
  const [rOrder,rRetry,wOrder] = await Promise.all([
    retail('checkout',retailReview),retail('checkout',retailReview),wholesale('checkout',wholesaleReview)
  ]);
  assert.equal(rOrder.id,rRetry.id);
  assert.equal((await retail('orders')).length,1);
  await wholesale('order',{id:rOrder.id},404);
  await admin('admin.delivery',{id:rOrder.id,freight_cents:1500,carrier:'Transportadora de teste',tracking:'COD-TESTE'});
  assert.equal((await retail('order',{id:rOrder.id})).freight_cents,1500);
  assert.equal((await retail('order',{id:rOrder.id})).tracking_code,'COD-TESTE');
  await retail('support',{id:wOrder.id,message:'Tentativa de ver outro pedido'},404);
  await retail('support',{id:rOrder.id,message:'Dúvida sobre meu pedido'});
  assert.equal((await retail('order.reorder',{id:rOrder.id})).subtotal,12000);
  assert.equal((await admin('admin.dashboard',{search:sku})).products[0].reserved,0);

  // Use different admin accounts so the product row, rather than an account lock, serializes these reservations.
  const otherEmail='admin2-'+suffix+'@example.test';
  await pool.query(`INSERT INTO maxdistrib.accounts(id,email,password_hash,name,phone,role,status,accepted_terms)
    VALUES($1,$2,$3,'Admin Dois','81912345678','ADMIN','ACTIVE','FIXTURE')`,[randomUUID(),otherEmail,await passwordHash(password)]);
  const otherAdmin=client();
  await otherAdmin('login',{email:otherEmail,password});
  const competing = await Promise.allSettled([
    admin('admin.orderStatus',{id:rOrder.id,status:'CONFIRMED'}),
    otherAdmin('admin.orderStatus',{id:wOrder.id,status:'CONFIRMED'})
  ]);
  assert.equal(competing.filter(item=>item.status==='fulfilled').length,1);
  assert.match(competing.find(item=>item.status==='rejected').reason.message,/Saldo insuficiente/);
  const winning = competing.find(item=>item.status==='fulfilled').value;
  const losing = winning.id===rOrder.id?wOrder:rOrder;
  await admin('admin.orderStatus',{id:winning.id,status:'CANCELLED'});
  const confirmed=await admin('admin.orderStatus',{id:losing.id,status:'CONFIRMED'});
  await admin('admin.orderStatus',{id:losing.id,status:'CONFIRMED'});
  assert.equal((await admin('admin.dashboard',{search:sku})).products[0].reserved,confirmed.items[0].quantity);
  await admin('admin.orderStatus',{id:losing.id,status:'PICKING'});
  await admin('admin.orderStatus',{id:losing.id,status:'SHIPPED'});
  await admin('admin.orderStatus',{id:losing.id,status:'DELIVERED'});
  const {products:[stock]}=await admin('admin.dashboard',{search:sku});
  assert.equal(stock.reserved,0);
  assert.equal(stock.on_hand,12-confirmed.items[0].quantity);

  // Validate single-use recovery without sending email outside the isolated environment.
  const recovery=token(), expired=token(), newPassword=password+'-new';
  await pool.query(`INSERT INTO maxdistrib.password_resets VALUES($1,$2,now()+interval '30 minutes'),
    ($3,$2,now()-interval '1 minute')`,[hash(recovery),customer.id,hash(expired)]);
  await anonymous('password.reset',{token:expired,password:newPassword,confirmPassword:newPassword},400);
  await anonymous('password.reset',{token:recovery,password:newPassword,confirmPassword:newPassword});
  await anonymous('password.reset',{token:recovery,password:newPassword,confirmPassword:newPassword},400);
  await retail('cart',{},401);
  await retail('login',{email:retailEmail,password},401);
  await retail('login',{email:retailEmail,password:newPassword});
  await pool.query("UPDATE maxdistrib.sessions SET expires_at=now()-interval '1 minute' WHERE account_id=$1",[customer.id]);
  await retail('cart',{},401);
});
