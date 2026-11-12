import { expect, test } from '@playwright/test';
import { database } from '../server/db.js';
const sku = 'BROWSER-PORTAL-QA';
const product = 'Produto isolado para teste do portal';
test.beforeAll(async () => {
  const db = new URL(process.env.MAXDISTRIB_DATABASE_URL);
  if (process.env.MAXDISTRIB_TEST_DB!=='1' || db.hostname!=='localhost' || db.pathname!=='/maxdistrib_test') throw new Error('Use o banco isolado de testes.');
  const pool=await database();
  await pool.query(`INSERT INTO maxdistrib.products(sku,name,category,brand,retail_cents,active,on_hand)
    VALUES($1,$2,'Teste','QA',2300,true,20) ON CONFLICT(sku) DO NOTHING`,[sku,product]);
  await pool.end();
});
test('vitrine, ofertas e centro 3D continuam disponíveis',async ({page})=>{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Suplementos no atacado',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Comprar pelo portal'})).toBeVisible();
  await page.getByRole('button',{name:'Próximo destaque'}).click();
  await page.goto('/ofertas');
  await expect(page.getByText('88 ofertas',{exact:true})).toBeVisible();
  await page.goto('/estoque');
  await page.getByText('Centro de Distribuição 3D',{exact:true}).click();
  await page.getByRole('button',{name:'Planta 2D',exact:true}).click();
  await expect(page.getByRole('button',{name:'Planta 2D',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('desktop, tablet e mobile: seleção visitante, login, checkout e pedido',async ({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  await page.goto('/minha-conta#produtos');
  await expect(page.getByRole('heading',{name:product})).toBeVisible();
  await page.getByRole('article').filter({hasText:product}).getByRole('button',{name:'Adicionar ao carrinho'}).click();
  await page.getByRole('link',{name:'Ver seleção'}).click();
  await expect(page.getByText(product+' × 1',{exact:false})).toBeVisible();
  await page.getByRole('link',{name:'Entrar para continuar'}).click();
  await page.getByRole('link',{name:'Criar conta'}).click();
  await expect(page.getByRole('button',{name:/Sou revendedor/})).toBeVisible();
  await page.getByRole('button',{name:/Comprar para mim/}).click();
  await page.getByLabel('Nome completo').fill('Cliente QA');
  await page.getByLabel('E-mail').fill('browser-'+Date.now()+'@example.test');
  await page.getByLabel('Telefone / WhatsApp').fill('81912345678');
  await page.getByLabel('Senha',{exact:true}).fill('fixture-isolated-secret-01');
  await page.getByLabel('Confirme a senha').fill('fixture-isolated-secret-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Criar conta'}).click();
  await expect(page.getByRole('heading',{name:'Meu carrinho'})).toBeVisible();
  await expect(page.getByText(product,{exact:true})).toBeVisible();
  for (const width of [1440,820,430,390,320]) {
    await page.setViewportSize({width,height:850});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.getByRole('button',{name:'Menu'}).click();
  await expect(page.getByRole('navigation').getByRole('link',{name:'Meus pedidos'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Menu'})).toHaveAttribute('aria-expanded','false');
  await page.getByRole('link',{name:'Continuar para endereço'}).click();
  await page.getByRole('link',{name:'Cadastrar endereço'}).click();
  for (const [label,value] of Object.entries({CEP:'50000-000',Rua:'Rua QA',Número:'123',Bairro:'Centro',Cidade:'Recife',UF:'PE'})) {
    await page.getByLabel(label,{exact:true}).fill(value);
  }
  await page.getByRole('button',{name:'Salvar endereço'}).click();
  await page.getByRole('button',{name:'Revisar pedido'}).click();
  await page.getByRole('button',{name:'Enviar solicitação'}).click();
  await expect(page.getByRole('heading',{name:/^NE-[A-F0-9]{16}$/})).toBeVisible();
  await expect(page.getByText('Recebido',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
