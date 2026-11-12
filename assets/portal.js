import { adminView } from './portal-admin.js';
const main = document.querySelector('#portal-content');
const nav = document.querySelector('#portal-nav');
const menu = document.querySelector('#portal-menu');
const feedback = document.querySelector('#portal-feedback');
const RETAIL = 'RETAIL_CUSTOMER';
const WHOLESALE = 'WHOLESALE_RESELLER';
const labels = {
  RECEIVED:'Recebido', AWAITING_CONFIRMATION:'Aguardando confirmação', CONFIRMED:'Confirmado', PICKING:'Em separação',
  SHIPPED:'Enviado', DELIVERED:'Entregue', CANCELLED:'Cancelado', ACTIVE:'Ativo', PENDING_APPROVAL:'Aguardando aprovação',
  REJECTED:'Cadastro rejeitado', SUSPENDED:'Suspenso', [RETAIL]:'Cliente de varejo', [WHOLESALE]:'Revendedor de atacado'
};
const pages = [['inicio','Visão geral'],['produtos','Comprar produtos'],['carrinho','Meu carrinho'],['pedidos','Meus pedidos'],
  ['favoritos','Favoritos'],['enderecos','Meus endereços'],['ofertas','Ofertas'],['atendimento','Atendimento'],
  ['perfil','Meu perfil'],['configuracoes','Configurações']];
let account, config, review, checkoutKey, timer, renderVersion = 0;
let catalogSearch = '', catalogCategory = '';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date = value => new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
const button = (label, attrs='', secondary=false) => `<button type="button" class="btn ${secondary?'btn-o':'btn-p'}" ${attrs}>${label}</button>`;
const link = (label,href) => `<a class="btn btn-o" href="${esc(href)}">${label}</a>`;
const heading = (title,subtitle='') => `<header><h1>${title}</h1>${subtitle?'<p>'+subtitle+'</p>':''}</header>`;
const empty = (message,extra='') => `<div class="card stack"><p>${message}</p>${extra}</div>`;
const field = (name,label,attrs='',value='') => `<label>${label}<input class="fi" name="${name}" ${attrs} value="${esc(value)}"></label>`;
const submit = label => `<button class="btn btn-p" type="submit">${label}</button>`;
const badge = value => esc(labels[value] || value);
const session = async () => (await api('session')).account;
async function api(action, data={}) {
  const response = await fetch('/api/portal',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...data,action}),credentials:'same-origin'});
  const value = await response.json();
  if (!response.ok) {
    if (response.status===401 && action!=='login') { account = null; review = null; draw(); }
    throw new Error(value.error || 'A operação não pôde ser concluída.');
  }
  return value;
}
function notice(message,error=false) {
  feedback.textContent = message;
  feedback.classList.toggle('error',error);
  clearTimeout(timer);
  timer = setTimeout(()=>{ feedback.textContent=''; },6000);
}
function setMenu(open) {
  nav.classList.toggle('open',open);
  menu.setAttribute('aria-expanded',String(open));
}
function go(page) {
  setMenu(false);
  if (location.hash === '#'+page) draw();
  else location.hash = page;
}
menu.onclick = () => setMenu(menu.getAttribute('aria-expanded')!=='true');
window.addEventListener('hashchange', () => { setMenu(false); draw(); });
document.addEventListener('keydown',event=>{ if(event.key==='Escape' && menu.getAttribute('aria-expanded')==='true') { setMenu(false); menu.focus(); } });
nav.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
function authView(page) {
  const terms = config.terms && config.privacy && config.termsVersion;
  const login = heading('Minha Conta','Acesse seus pedidos, favoritos e endereços.');
  if (page.startsWith('recuperar=') && config.recovery) {
    return login + `<form data-form="reset" class="card entry stack">${field('password','Nova senha','type="password" autocomplete="new-password" required minlength="12" maxlength="128"')}
      ${field('confirmPassword','Confirme a nova senha','type="password" autocomplete="new-password" required minlength="12" maxlength="128"')}
      ${submit('Redefinir senha')}</form>`;
  }
  if (page==='recuperar' && config.recovery) {
    return login + `<form data-form="forgot" class="card entry stack"><h2>Recuperar senha</h2>
      ${field('email','E-mail','type="email" autocomplete="email" required maxlength="254"')}
      <div class="actions">${submit('Enviar link')}${link('Voltar','#entrar')}</div></form>`;
  }
  if (page==='criar') {
    if (!terms) return login + empty('Cadastro temporariamente indisponível.',link('Voltar','#entrar'));
    return login + `<section class="card entry stack"><h2>Como você pretende comprar?</h2><div class="tiles">
      ${button('<span aria-hidden="true">&#128717;</span><strong>Comprar para mim</strong><small>Compre seus suplementos favoritos por unidade, com praticidade e segurança.</small>','data-go="cadastro-varejo"',true).replace('btn btn-o','btn btn-o role-choice')}
      ${button('<span aria-hidden="true">&#127978;</span><strong>Sou revendedor</strong><small>Compre para revenda com condições de atacado e preços especiais por quantidade.</small>','data-go="cadastro-atacado"',true).replace('btn btn-o','btn btn-o role-choice')}
      </div>${link('Voltar','#entrar')}</section>`;
  }
  if (terms && ['cadastro-varejo','cadastro-atacado'].includes(page)) {
    const reseller = page.endsWith('atacado');
    return login + `<form data-form="register" data-role="${reseller?WHOLESALE:RETAIL}" class="card entry stack">
      <h2>${reseller?'Cadastro para revenda':'Cadastro para varejo'}</h2>
      ${reseller?'<p class="muted">O acesso às condições de atacado depende de aprovação.</p>':''}
      <div class="fields">
      ${field('name',reseller?'Nome do responsável':'Nome completo','autocomplete="name" required maxlength="120"')}
      ${field('email','E-mail','type="email" autocomplete="email" required maxlength="254"')}
      ${field('phone','Telefone / WhatsApp','type="tel" autocomplete="tel" required maxlength="30"')}
      ${reseller?field('business','Nome comercial ou razão social','autocomplete="organization" required maxlength="120"')
        + field('taxId','CPF ou CNPJ','inputmode="numeric" required maxlength="24"')
        + field('city','Cidade','autocomplete="address-level2" required maxlength="120"')
        + field('state','UF','autocomplete="address-level1" required maxlength="2"') : ''}
      ${field('password','Senha','type="password" autocomplete="new-password" required minlength="12" maxlength="128"')}
      ${field('confirmPassword','Confirme a senha','type="password" autocomplete="new-password" required minlength="12" maxlength="128"')}
      </div>
      <label><input type="checkbox" name="accepted" required> Aceito os <a href="${esc(config.terms)}" target="_blank" rel="noopener">termos</a>
      e a <a href="${esc(config.privacy)}" target="_blank" rel="noopener">política de privacidade</a>.</label>
      <div class="actions">${submit('Criar conta')}${link('Voltar','#criar')}</div></form>`;
  }
  return login + `<form data-form="login" class="card entry stack"><h2>Entrar</h2>
    ${field('email','E-mail','type="email" autocomplete="username" required maxlength="254"')}
    ${field('password','Senha','type="password" autocomplete="current-password" required maxlength="128"')}
    <div class="actions">${submit('Entrar')}${terms?link('Criar conta','#criar'):''}${config.recovery?link('Esqueci minha senha','#recuperar'):''}</div></form>`;
}
function ordersList(list) {
  return list.length ? list.map(order=>`<div class="row"><div><strong>${esc(order.code)}</strong>
    <p class="muted">${badge(order.status)} · ${date(order.created_at)}</p></div>
    ${order.subtotal_cents?'<strong>'+money(order.subtotal_cents)+'</strong>':''}
    ${link('Ver pedido','#pedido='+order.id)}</div>`).join('') : '<p class="muted">Nenhum pedido registrado.</p>';
}
async function overview() {
  const data = await api('overview');
  const metrics = [[data.counts.total,'Pedidos'],[data.counts.pending,'Em andamento'],[data.counts.completed,'Concluídos'],[data.favorites,'Favoritos']];
  if (account.role===WHOLESALE) metrics.push([money(data.counts.month_total),'Compras entregues no mês']);
  return heading('Olá, '+esc(account.name.split(' ')[0])+'.','Acompanhe seus pedidos e encontre os produtos que você precisa.')
    + (account.role===WHOLESALE?'<p class="notice">'+badge(account.status)+'</p>':'')
    + `<div class="stack"><div class="tiles">${metrics.map(([value,label])=>`<section class="card"><strong class="metric">${value}</strong><p>${label}</p></section>`).join('')}</div>
    <section class="card stack"><h2>Últimos pedidos</h2>${ordersList(data.recent)}${link('Todos os pedidos','#pedidos')}</section>
    <section class="card stack"><h2>Continue comprando</h2><div class="actions">${link('Ver produtos','#produtos')}${link('Ver ofertas','#ofertas')}</div>
    ${data.frequent.length?'<h2>Comprados com frequência</h2><ul>'+data.frequent.map(p=>'<li>'+esc(p.name)+'</li>').join('')+'</ul>':''}</section></div>`;
}
function products(list, favorites, favoritePage=false) {
  if (!list.length) return empty(favoritePage?'Você ainda não salvou produtos.':'Nenhum produto disponível para esta seleção.',favoritePage?link('Ver produtos','#produtos'):'');
  const reseller = account.role===WHOLESALE;
  return `<div class="products">${list.map(product=>{
    const saved = favorites.has(product.sku);
    const tiers = reseller ? product.tiers || [] : [];
    const price = reseller ? tiers[0]?.cents : product.retail_cents;
    const minimum = reseller ? tiers[0]?.minimum || 1 : 1;
    const available = product.active && product.available>=minimum && !!price;
    return `<article class="card">
      ${product.image?'<img src="'+esc(product.image)+'" alt="" loading="lazy" width="230" height="150">':''}
      <p class="muted">${esc(product.brand)} · ${esc(product.category)}</p><h2>${esc(product.name)}</h2>
      ${price?'<p class="price">'+money(price)+' / un.</p>':'<p class="muted">Preço indisponível para seu perfil.</p>'}
      ${tiers.length?'<p>Mínimo de '+minimum+' un. · múltiplos de '+product.multiple+'</p><ul>'+tiers.map(t=>{
        const savings = product.retail_cents > t.cents ? ' · economia de '+money(product.retail_cents-t.cents)+' / un.' : '';
        return '<li>A partir de '+t.minimum+' un. · '+money(t.cents)+' / un.'+savings+'</li>';
      }).join('')+'</ul>':''}
      <p class="muted">${available?'Disponível':'Indisponível para compra'}</p>
      <div class="actions">${available?button('Adicionar ao carrinho','data-action="cart.set" data-sku="'+esc(product.sku)+'" data-quantity="'+minimum+'"') : ''}
      ${button(saved?'Remover dos favoritos':'Salvar nos favoritos','data-action="favorite.set" data-sku="'+esc(product.sku)+'" data-saved="'+(!saved)+'"',true)}</div>
    </article>`;
  }).join('')}</div>`;
}
async function catalog(favoritePage) {
  const favorites = await api('favorites');
  const saved = new Set(favorites.map(p=>p.sku));
  if (favoritePage) return heading('Favoritos') + products(favorites,saved,true);
  const list = await api('catalog',{search:catalogSearch,category:catalogCategory});
  const all = catalogCategory || catalogSearch ? await api('catalog') : list;
  const categories = [...new Set(all.map(p=>p.category))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return heading('Comprar produtos')+`<div class="stack">
    ${account.role===WHOLESALE && account.status!=='ACTIVE'?'<p class="notice">Condições de atacado disponíveis após a aprovação do cadastro.</p>':''}
    <form class="card actions" data-form="search">${field('search','Buscar produtos','type="search" maxlength="100"',catalogSearch)}
    <label>Categoria<select class="fi" name="category"><option value="">Todas</option>${categories.map(category=>`<option ${category===catalogCategory?'selected':''}>${esc(category)}</option>`).join('')}</select></label>
    ${submit('Filtrar')}</form>${products(list,saved)}</div>`;
}
function addressLabel(details) { return esc([details.street+', '+details.number,details.complement,details.district,details.city+' – '+details.state,details.zip,details.reference].filter(Boolean).join(' · ')); }
function addressForm(record={}, back='#enderecos') {
  const v = record.details || {};
  return `<form data-form="address" class="card stack" data-id="${record.id || ''}" data-back="${back}">
    <div class="fields">
    ${field('zip','CEP','inputmode="numeric" autocomplete="postal-code" required maxlength="10"',v.zip)}
    ${field('street','Rua','autocomplete="address-line1" required maxlength="120"',v.street)}
    ${field('number','Número','required maxlength="20"',v.number)}
    ${field('complement','Complemento','autocomplete="address-line2" maxlength="120"',v.complement)}
    ${field('district','Bairro','required maxlength="120"',v.district)}
    ${field('city','Cidade','autocomplete="address-level2" required maxlength="120"',v.city)}
    ${field('state','UF','autocomplete="address-level1" required maxlength="2"',v.state)}
    ${field('reference','Referência (opcional)','maxlength="200"',v.reference)}
    </div>
    <label><input type="checkbox" name="primary" ${record.is_primary?'checked':''}> Endereço principal</label>
    <div class="actions">${submit('Salvar endereço')}${link('Cancelar',back)}</div></form>`;
}
async function addresses(page) {
  const list = await api('addresses');
  const id = page.split('=')[1];
  if (id) {
    const record = list.find(item=>item.id===id);
    return heading('Editar endereço')+(record?addressForm(record):empty('Endereço não encontrado.'));
  }
  return heading('Meus endereços')+`<div class="card stack">${list.map(record=>`<div class="row"><div>
    <p>${addressLabel(record.details)}</p>${record.is_primary?'<strong>Principal</strong>':''}</div><div class="actions">
    ${link('Editar','#endereco='+record.id)}${button('Excluir','data-action="address.delete" data-id="'+record.id+'"',true)}</div></div>`).join('')
    || '<p>Nenhum endereço cadastrado.</p>'}${link('Novo endereço','#novo-endereco')}</div>`;
}
async function cartPage() {
  const current = await api('cart');
  if (!current.items.length) return heading('Meu carrinho') + empty('Seu carrinho está vazio.',link('Continuar comprando','#produtos'));
  return heading('Meu carrinho')+`<section class="card stack">${current.items.map(item=>{
    const step = account.role===WHOLESALE ? item.multiple || 1 : 1;
    const minimum = item.tiers?.[0]?.minimum || 1;
    return `<div class="row"><div><strong>${esc(item.name)}</strong><p class="${item.error?'error':'muted'}">${item.error?esc(item.error):money(item.unit_cents)+' / un.'}</p></div>
    <form class="actions" data-form="quantity" data-sku="${esc(item.sku)}">
      ${field('quantity','Quantidade',`type="number" class="num" min="${minimum}" max="10000" step="${step}" required`,item.quantity)}
      ${submit('Atualizar')}${button('Remover','data-action="cart.remove" data-sku="'+esc(item.sku)+'"',true)}
    </form></div>`;
  }).join('')}
  <p class="price">Subtotal de itens válidos · ${money(current.subtotal)}</p>
  <div class="actions">${button('Limpar carrinho','data-action="cart.clear"',true)}
  ${config.deliveryQuote && !current.items.some(i=>i.error)?link('Continuar para endereço','#checkout'):''}</div>
  ${!config.deliveryQuote?'<p class="notice">A entrega ainda não está configurada para pedidos pelo portal.</p>':''}</section>`;
}
async function checkoutPage() {
  const list = await api('addresses');
  return heading('Endereço de entrega','Carrinho → Identificação → Endereço → Revisão → Confirmação')
    + (list.length ? `<form class="card stack" data-form="review"><p>Identificação · ${esc(account.name)} (${esc(account.email)})</p>
      <label>Entregar em<select class="fi" name="addressId" required>${list.map(a=>`<option value="${a.id}">${addressLabel(a.details)}</option>`).join('')}</select></label>
      <p>Entrega mediante cotação. A equipe confirma o frete e as condições antes do pagamento.</p>
      <div class="actions">${submit('Revisar pedido')}${link('Novo endereço','#endereco-checkout')}</div></form>`
      : empty('Cadastre um endereço para continuar.',link('Cadastrar endereço','#endereco-checkout')));
}
function reviewPage() {
  if (!review) return heading('Revisar pedido')+empty('Selecione seu endereço para revisar o pedido.',link('Selecionar endereço','#checkout'));
  return heading('Revisar pedido')+`<section class="card stack">
    <p><strong>Entrega:</strong> ${addressLabel(review.address.details)}</p>
    ${review.items.map(i=>`<div class="row"><p>${esc(i.name)} × ${i.quantity}</p><strong>${money(i.unit_cents*i.quantity)}</strong></div>`).join('')}
    <p class="price">Subtotal dos produtos · ${money(review.subtotal)}</p><p>Frete a cotar. O envio registra uma solicitação de pedido para confirmação comercial.</p>
    ${button('Enviar solicitação','data-action="checkout"')}${link('Alterar endereço','#checkout')}</section>`;
}
function orderDetails(order, admin=false) {
  return `<section class="card stack"><p><strong>${badge(order.status)}</strong> · ${date(order.created_at)}</p>
    ${order.cancellation_requested_at?'<p class="notice">Cancelamento solicitado.</p>':''}
    <p>${badge(order.role)} · Entrega mediante cotação</p><p>${addressLabel(order.address)}</p>
    ${order.items.map(i=>`<div class="row"><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(i.unit_cents*i.quantity)}</strong></div>`).join('')}
    <p class="price">Subtotal dos produtos · ${money(order.subtotal_cents)}</p><h2>Histórico do pedido</h2>
    <ol>${order.events.map(e=>`<li>${badge(e.status)} · ${date(e.created_at)}</li>`).join('')}</ol>
    ${admin?'':`<div class="actions">${button('Comprar novamente','data-action="order.reorder" data-id="'+order.id+'"')}
      ${link('Solicitar atendimento','#atendimento='+order.id)}
      ${!order.cancellation_requested_at && ['RECEIVED','AWAITING_CONFIRMATION','CONFIRMED','PICKING'].includes(order.status)
        ?button('Solicitar cancelamento','data-action="order.cancel" data-id="'+order.id+'"',true):''}</div>`}</section>`;
}
async function support(page) {
  const id = page.split('=')[1];
  const order = id ? await api('order',{id}) : null;
  return heading('Atendimento')+`<div class="stack"><section class="card stack"><h2>Fale com a NE</h2>
    <div class="actions">${link('Loja oficial',config.support)}${config.contact?link('WhatsApp oficial',config.contact):''}</div>
    <details><summary>Como acompanho meu pedido?</summary><p>Consulte o status e o histórico em Meus pedidos.</p></details>
    <details><summary>Como funciona a entrega?</summary><p>Quando o pedido exige cotação, a equipe confirma os valores e as condições após receber a solicitação.</p></details>
    <details><summary>Como acesso o atacado?</summary><p>Solicite cadastro como revendedor e acompanhe a aprovação em Meu perfil.</p></details></section>
    <form class="card stack" data-form="support" data-id="${order?.id||''}">
    <h2>Solicitar suporte</h2>${order?'<p>Sobre o pedido '+esc(order.code)+'</p>':''}
    <label>Mensagem<textarea class="fi" name="message" required minlength="8" maxlength="2000" rows="4"></textarea></label>${submit('Enviar solicitação')}</form></div>`;
}
function profile() {
  return heading('Meu perfil')+`<form class="card stack" data-form="profile">
    <p>${esc(account.email)} · ${badge(account.role)} · ${badge(account.status)}</p>
    ${account.business?'<p>'+esc(account.business)+' · '+esc(account.tax_id)+' · '+esc(account.city)+' / '+esc(account.state)+'</p>':''}
    <div class="fields">${field('name','Nome','required maxlength="120"',account.name)}
    ${field('phone','Telefone / WhatsApp','type="tel" required maxlength="30"',account.phone)}</div>
    ${submit('Salvar perfil')}${link('Gerenciar endereços','#enderecos')}</form>`;
}
function settings() {
  const current = field('currentPassword','Senha atual','type="password" autocomplete="current-password" required maxlength="128"');
  return heading('Configurações')+`<div class="stack"><form class="card stack" data-form="password.change"><h2>Alterar senha</h2>
    <div class="fields">${current}${field('password','Nova senha','type="password" autocomplete="new-password" required minlength="12" maxlength="128"')}
    ${field('confirmPassword','Confirme a nova senha','type="password" autocomplete="new-password" required minlength="12" maxlength="128"')}</div>
    ${submit('Alterar senha')}</form>
    <form class="card stack" data-form="sessions.revoke"><h2>Outras sessões</h2>${current}${submit('Encerrar outras sessões')}</form>
    <form class="card stack" data-form="account.delete"><h2>Exclusão da conta</h2>
    ${account.deletion_requested_at?'<p>Solicitação registrada em '+date(account.deletion_requested_at)+'.</p>':current+submit('Solicitar exclusão')}</form></div>`;
}
async function customerPage(page) {
  const name = page.split('=')[0];
  if (name==='produtos' || name==='favoritos') return catalog(name==='favoritos');
  if (name==='enderecos' || name==='endereco') return addresses(page);
  if (name==='novo-endereco' || name==='endereco-checkout') return heading('Novo endereço')+addressForm({},name==='endereco-checkout'?'#checkout':'#enderecos');
  if (name==='carrinho') return cartPage();
  if (name==='checkout') return checkoutPage();
  if (name==='revisao') return reviewPage();
  if (name==='pedidos') return heading('Meus pedidos')+`<section class="card">${ordersList(await api('orders'))}</section>`;
  if (name==='pedido') {
    const order = await api('order',{id:page.split('=')[1]});
    return heading(esc(order.code))+orderDetails(order);
  }
  if (name==='ofertas') return heading('Ofertas')+empty('Consulte os encartes públicos e as condições de cada campanha.',link('Abrir ofertas','/ofertas'));
  if (name==='atendimento') return support(page);
  if (name==='perfil') return profile();
  if (name==='configuracoes') return settings();
  return overview();
}
const admin = adminView({api,esc,money,date,button,link,heading,empty,field,submit,badge,orderDetails,notice});
async function draw() {
  const version = ++renderVersion;
  const page = location.hash.slice(1) || 'inicio';
  const isAdmin = account?.role==='ADMIN';
  nav.hidden = !account;
  menu.hidden = !account;
  nav.innerHTML = account ? (isAdmin ? admin.links(page) : pages.map(([id,label])=>`<a href="#${id}"${id===page?' aria-current="page"':''}>${label}</a>`).join(''))
    + button('Sair','data-action="logout"',true) : '';
  main.setAttribute('aria-busy','true');
  try {
    const html = !config?.enabled ? heading('Minha Conta')+empty('O portal está temporariamente indisponível.',link('Voltar à vitrine','/'))
      : !account ? authView(page) : isAdmin ? await admin.render(page) : await customerPage(page);
    if (version===renderVersion) main.innerHTML = html;
  } catch (error) {
    if (version===renderVersion) main.innerHTML = heading('Minha Conta')+empty(esc(error.message),button('Tentar novamente','data-action="reload"',true));
  } finally {
    if (version===renderVersion) main.setAttribute('aria-busy','false');
  }
}
async function formAction(form,data) {
  const action = form.dataset.form;
  if (action.startsWith('admin.')) { await admin.form(action,form,data); draw(); return; }
  if (action==='login' || action==='register') {
    if (action==='register') Object.assign(data,{role:form.dataset.role,accepted:data.accepted==='on',termsVersion:config.termsVersion});
    await api(action,data); account = await session(); go('inicio'); return;
  }
  if (action==='forgot') { await api('password.forgot',data); notice('Se houver uma conta para esse e-mail, você receberá um link.'); go('entrar'); return; }
  if (action==='reset') {
    await api('password.reset',{...data,token:location.hash.slice('#recuperar='.length)});
    account = null; notice('Senha redefinida. Entre novamente.'); go('entrar'); return;
  }
  if (action==='search') { catalogSearch=data.search; catalogCategory=data.category; draw(); return; }
  if (action==='quantity') { await api('cart.set',{sku:form.dataset.sku,quantity:Number(data.quantity)}); draw(); return; }
  if (action==='address') { await api('address.save',{...data,id:form.dataset.id,primary:data.primary==='on'}); go(form.dataset.back.slice(1)); return; }
  if (action==='review') {
    const [current,list] = await Promise.all([api('cart'),api('addresses')]);
    const address = list.find(a=>a.id===data.addressId);
    if (!address || !current.items.length || current.items.some(i=>i.error)) throw new Error('Revise o carrinho e selecione um endereço válido.');
    review={...current,address}; checkoutKey=crypto.randomUUID(); go('revisao'); return;
  }
  if (action==='profile') account = await api('profile',data);
  else await api(action,{...data,id:form.dataset.id});
  notice(action==='support'?'Solicitação registrada.':'Alteração registrada.');
  draw();
}
async function clickAction(el) {
  const {action,id,sku,quantity,saved} = el.dataset;
  if (action==='reload') { await start(); return; }
  if (action==='logout') { await api('logout'); account=null; review=null; go('entrar'); return; }
  if (action==='cart.set') { await api(action,{sku,quantity:Number(quantity),add:true}); notice('Produto adicionado ao carrinho.'); return; }
  if (action==='cart.remove') await api('cart.set',{sku,quantity:0});
  else if (action==='favorite.set') await api(action,{sku,saved:saved==='true'});
  else if (action==='checkout') {
    if (!review) return;
    const order = await api(action,{key:checkoutKey,addressId:review.address.id,subtotal:review.subtotal,
      items:review.items.map(({sku,quantity,unit_cents})=>({sku,quantity,unit_cents}))});
    review=null; notice('Solicitação '+order.code+' registrada.'); go('pedido='+order.id); return;
  } else {
    if (action==='address.delete' && !confirm('Excluir este endereço?')) return;
    if (action==='order.cancel' && !confirm('Solicitar o cancelamento deste pedido?')) return;
    await api(action,{id});
    if (action==='order.reorder') { go('carrinho'); return; }
  }
  draw();
}
async function perform(button, action) {
  if (button?.disabled) return;
  if (button) button.disabled=true;
  try { await action(); } catch (error) { notice(error.message,true); }
  finally { if (button) button.disabled=false; }
}
main.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  perform(event.submitter,()=>formAction(form,Object.fromEntries(new FormData(form))));
});
document.addEventListener('click',event=>{
  const el=event.target.closest('button[data-action],button[data-go]');
  if (!el) return;
  if (el.dataset.go) go(el.dataset.go);
  else perform(el,()=>clickAction(el));
});
async function start() {
  try {
    const response = await fetch('/api/portal',{headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error('Não foi possível acessar o portal.');
    config = await response.json();
    if (config.enabled) account = await session();
    await draw();
  } catch (error) { notice(error.message,true); await draw(); }
}
start();
