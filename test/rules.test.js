import test from 'node:test';
import assert from 'node:assert/strict';
import { RETAIL, WHOLESALE, quote, productView, stockEffect, taxId, address, imagePath } from '../server/rules.js';
import { configuration, cookie, passwordHash, verifyPassword } from '../server/auth.js';
import handler from '../api/portal.js';
const retail = {role:RETAIL,status:'ACTIVE'};
const wholesale = {role:WHOLESALE,status:'ACTIVE'};
const product = {sku:'X',active:true,on_hand:25,reserved:2,retail_cents:12000,
  wholesale_tiers:[{minimum:4,cents:10000},{minimum:12,cents:9000}],wholesale_multiple:4};
test('same product, server chooses profile and price by amount',()=>{
  assert.equal(quote(product,retail,1),12000);
  assert.equal(quote(product,wholesale,4),10000);
  assert.equal(quote(product,wholesale,12),9000);
  assert.equal(quote(product,wholesale,20),9000);
  assert.throws(()=>quote(product,wholesale,5),{status:409});
  assert.throws(()=>quote(product,wholesale,24),{status:409});
  assert.throws(()=>quote(product,retail,-1),{status:400});
  assert.throws(()=>quote({...product,retail_cents:null},retail,1),{status:409});
  assert.throws(()=>quote({...product,wholesale_until:'2024-01-01'},wholesale,4,Date.parse('2025-01-01')),{status:409});
});
test('pending reseller and retail cannot read restricted tiers',()=>{
  const pending = {...wholesale,status:'PENDING_APPROVAL'};
  assert.equal(productView(product,pending).tiers,undefined);
  assert.equal(productView(product,retail).tiers,undefined);
  assert.throws(()=>quote(product,pending,12),{status:403});
});
test('stock effects reserve, release and ship at the authorized states',()=>{
  assert.deepEqual(stockEffect('RECEIVED','CONFIRMED',4),['RESERVED',0,4]);
  assert.deepEqual(stockEffect('CONFIRMED','CANCELLED',4),['RELEASED',0,-4]);
  assert.deepEqual(stockEffect('PICKING','SHIPPED',4),['SHIPPED',-4,-4]);
  assert.equal(stockEffect('RECEIVED','CANCELLED',4),null);
  assert.throws(()=>stockEffect('SHIPPED','CANCELLED',4),{status:409});
});
test('passwords are salted, session cookies are secure and portal is off by default',async()=>{
  const password = 'test-only-password-01';
  const hash = await passwordHash(password);
  assert.notEqual(hash,await passwordHash(password));
  assert.equal(await verifyPassword(password,hash),true);
  assert.equal(await verifyPassword('wrong password',hash),false);
  assert.equal(await verifyPassword(password,undefined),false);
  assert.match(cookie('token',true),/HttpOnly; SameSite=Lax; Path=.*; Secure/);
  assert.equal(configuration({}).enabled,false);
  const config = await handler(new Request('https://portal.test/api/portal'));
  assert.equal(config.headers.get('cache-control'),'no-store');
  const forbidden = await handler(new Request('https://portal.test/api/portal',{method:'POST',headers:{origin:'https://elsewhere.test'}}));
  assert.equal(forbidden.status,403);
});
test('CPF/CNPJ, addresses and asset paths are validated',()=>{
  assert.equal(taxId('529.982.247-25'),'52998224725');
  assert.equal(taxId('04.252.011/0001-10'),'04252011000110');
  assert.throws(()=>taxId('000.000.000-00'),{status:400});
  assert.throws(()=>address({zip:'123'}),{status:400});
  assert.throws(()=>imagePath('/Public/../file.webp'),{status:400});
  assert.equal(imagePath('/Public/suplementos/Whey.webp'),'/Public/suplementos/Whey.webp');
});
