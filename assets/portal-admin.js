export function adminView(ui) {
  const {api,esc,money,date,button,link,heading,empty,field,submit,badge,orderDetails,notice} = ui;
  const routes = [['admin','Clientes'],['admin-pedidos','Pedidos'],['admin-produtos','Produtos e preços'],['admin-estoque','Estoque'],['admin-atendimento','Atendimento']];
  const statuses = ['PENDING_APPROVAL','ACTIVE','REJECTED','SUSPENDED','RECEIVED','AWAITING_CONFIRMATION','CONFIRMED','PICKING','SHIPPED','DELIVERED','CANCELLED'];
  const transitions = {RECEIVED:['AWAITING_CONFIRMATION','CONFIRMED','CANCELLED'],AWAITING_CONFIRMATION:['CONFIRMED','CANCELLED'],
    CONFIRMED:['PICKING','CANCELLED'],PICKING:['SHIPPED','CANCELLED'],SHIPPED:['DELIVERED']};
  let search='',status='',campaign;
  const options = (values,current) => values.map(value=>`<option value="${value}" ${value===current?'selected':''}>${badge(value)}</option>`).join('');
  const localDate = value => {
    if (!value) return '';
    const time = new Date(value);
    return new Date(+time-time.getTimezoneOffset()*60000).toISOString().slice(0,16);
  };
  const filter = () => `<form data-form="admin.filter" class="card actions">${field('search','Buscar','type="search" maxlength="100"',search)}
    <label>Status<select class="fi" name="status"><option value="">Todos</option>${options(statuses,status)}</select></label>${submit('Filtrar')}</form>`;
  const orderRow = (o) => `<div class="row"><div><strong>${esc(o.code)}</strong><p>${esc(o.name||'')} · ${badge(o.status)} · ${date(o.created_at)}</p>
    ${o.cancellation_requested_at?'<p class="error">Cancelamento solicitado</p>':''}</div><strong>${money(o.subtotal_cents)}</strong>
    ${link('Abrir pedido','#admin-pedido='+o.id)}</div>`;
  async function campaignReference() {
    if (!campaign) {
      await import('./encartes.js');
      campaign = window.NE_CAMPAIGN || [];
    }
    return `<details><summary>Consultar os encartes da NE</summary>
      <label>Produto ou combo do encarte<select class="fi" data-campaign-reference>
      <option value="">Selecione uma oferta</option>${campaign.map(item=>`<option value="${esc(item.id)}">${esc(item.n)}</option>`).join('')}</select></label>
      <div class="stack" data-campaign-details></div></details>`;
  }
  function showCampaign(select) {
    const item = campaign?.find(offer=>offer.id===select.value);
    const details = select.closest('details').querySelector('[data-campaign-details]');
    details.innerHTML = item ? `<p><strong>${esc(item.n)}</strong> · ${esc(item.br)} · ${esc(item.source)}</p>
      <ul>${item.tiers.map(t=>`<li>${esc(t.condition)} · ${money(Math.round(t.cash*100))} à vista
      ${t.card==null?'':' · '+money(Math.round(t.card*100))+' no cartão'}</li>`).join('')}</ul>
      <p class="muted">Confirme SKU, vigência, embalagem, sabor e mínimos antes de configurar as faixas. O encarte não define o preço de varejo.</p>` : '';
  }
  function productForm(p={}) {
    const tiers = (p.wholesale_tiers||[]).map(t=>t.minimum+':'+t.cents).join('\n');
    return `<form class="card stack" data-form="admin.product">
      <div class="fields">
      ${field('sku','SKU',p.sku?'readonly':'required maxlength="100"',p.sku)}
      ${field('name','Nome','required maxlength="120"',p.name)}
      ${field('brand','Marca','required maxlength="120"',p.brand)}
      ${field('category','Categoria','required maxlength="120"',p.category)}
      ${field('image','Caminho da imagem (/Public/…)','maxlength="500"',p.image)}
      ${field('retail','Preço de varejo em R$','type="number" min=".01" max="1000000" step=".01"',p.retail_cents==null?'':(p.retail_cents/100).toFixed(2))}
      ${field('multiple','Múltiplo de atacado','type="number" min="1" max="10000" required',p.wholesale_multiple??1)}
      ${field('until','Validade das faixas','type="datetime-local"',localDate(p.wholesale_until))}
      ${field('stockDelta','Ajuste do estoque (+ entrada / − saída)','type="number" step="1" min="-1000000" max="1000000"',0)}
      </div><label>Faixas de atacado (quantidade:centavos, uma por linha)<textarea class="fi" name="tiers" rows="3" placeholder="Quantidade:centavos">${esc(tiers)}</textarea></label>
      ${p.sku?'<p>Em estoque: '+p.on_hand+' · Reservado: '+p.reserved+'</p>':''}
      <label><input type="checkbox" name="active" ${p.active?'checked':''}> Disponível no catálogo</label>
      ${submit('Salvar produto')}</form>`;
  }
  async function render(page) {
    const [section,id] = page.split('=');
    if (section==='admin-cliente') {
      const {customer:c,orders} = await api('admin.account',{id});
      const allowed = c.role==='WHOLESALE_RESELLER'?statuses.slice(0,4):['ACTIVE','SUSPENDED'];
      return heading(esc(c.name))+`<div class="stack"><form data-form="admin.accountStatus" data-id="${id}" class="card stack">
        <p>${esc(c.email)} · ${esc(c.phone)} · ${badge(c.role)} · ${date(c.created_at)}</p>
        ${c.business?'<p>'+esc(c.business)+' · '+esc(c.tax_id)+' · '+esc(c.city)+' / '+esc(c.state)+'</p>':''}
        ${c.deletion_requested_at?'<p class="notice">Exclusão solicitada em '+date(c.deletion_requested_at)+'.</p>':''}
        <label>Status<select class="fi" name="status">${options(allowed,c.status)}</select></label>${submit('Atualizar conta')}</form>
        <section class="card"><h2>Pedidos</h2>${orders.map(orderRow).join('')||'<p>Nenhum pedido.</p>'}</section></div>`;
    }
    if (section==='admin-pedido') {
      const order = await api('admin.order',{id});
      const next = transitions[order.status]||[];
      return heading(esc(order.code))+`<div class="stack">${orderDetails(order,true)}
        ${next.length?`<form data-form="admin.orderStatus" data-id="${id}" class="card stack"><label>Novo status
        <select class="fi" name="status">${options(next,'')}</select></label>${submit('Atualizar status')}</form>`:''}
        ${order.status==='CANCELLED'?'':`<form data-form="admin.delivery" data-id="${id}" class="card stack">
        <h2>Entrega</h2><div class="fields">
        ${field('freight','Frete cotado em R$','type="number" min="0" max="1000000" step=".01"',order.freight_cents==null?'':(order.freight_cents/100).toFixed(2))}
        ${field('carrier','Transportadora','maxlength="120"',order.carrier)}
        ${field('tracking','Código de rastreio','maxlength="120"',order.tracking_code)}
        </div>${submit('Salvar entrega')}</form>`}
        <form data-form="admin.note" data-id="${id}" class="card stack"><h2>Observações internas</h2>
        ${order.notes.map(n=>'<p>'+esc(n.message)+' · '+date(n.created_at)+'</p>').join('')}
        <label>Observação<textarea class="fi" name="message" maxlength="2000" required></textarea></label>${submit('Adicionar observação')}</form></div>`;
    }
    if (section==='admin-novo-produto') return heading('Cadastrar produto')+`<div class="stack">
      <section class="card">${await campaignReference()}</section>${productForm()}</div>`;
    const data = await api('admin.dashboard',{search,status});
    if (section==='admin-pedidos') return heading('Pedidos')+`<div class="stack">${filter()}<section class="card">
      ${data.orders.map(orderRow).join('')||'<p>Nenhum pedido encontrado.</p>'}</section></div>`;
    if (section==='admin-produtos') return heading('Produtos e preços')+`<div class="stack">${filter()}${link('Cadastrar produto','#admin-novo-produto')}
      <section class="card">${await campaignReference()}</section><section class="card">${data.products.map(p=>'<details><summary>'+esc(p.name)+' · '+esc(p.sku)+'</summary>'+productForm(p)+'</details>').join('')||'<p>Nenhum produto cadastrado.</p>'}</section></div>`;
    if (section==='admin-estoque') return heading('Estoque operacional','Saldos utilizados pelo catálogo e pelos pedidos.')+`<div class="stack">
      ${link('Ajustar saldo em Produtos e preços','#admin-produtos')}
      <section class="card"><h2>Saldos</h2>${data.products.map(p=>`<div class="row"><strong>${esc(p.name)}</strong><p>${p.on_hand} em estoque · ${p.reserved} reservados</p></div>`).join('')||'<p>Nenhum saldo cadastrado.</p>'}</section>
      <section class="card"><h2>Movimentações</h2>${data.stock.map(s=>`<div class="row"><span>${esc(s.sku)} · ${date(s.created_at)}</span>
      <strong>${({ADJUSTED:'Ajuste',RESERVED:'Reserva',RELEASED:'Liberação',SHIPPED:'Saída'})[s.event]} · saldo ${s.on_hand_delta} · reserva ${s.reserved_delta}</strong></div>`).join('')||'<p>Nenhuma movimentação.</p>'}</section></div>`;
    if (section==='admin-atendimento') return heading('Atendimento')+`<section class="card stack">
      ${data.support.map(s=>`<div class="row"><div><strong>${esc(s.name)} · ${esc(s.email)}${s.code?' · '+esc(s.code):''}</strong><p>${esc(s.message)}</p></div>
      <span>${date(s.created_at)}</span></div>`).join('')||'<p>Nenhuma solicitação registrada.</p>'}</section>`;
    return heading('Clientes e revendedores')+`<div class="stack">${filter()}<section class="card">
      ${data.accounts.map(c=>`<div class="row"><div><strong>${esc(c.name)} · ${esc(c.email)}</strong>
      <p>${badge(c.role)} · ${badge(c.status)} · ${date(c.created_at)}</p></div>${link('Abrir conta','#admin-cliente='+c.id)}</div>`).join('')||'<p>Nenhuma conta encontrada.</p>'}</section></div>`;
  }
  function links(page) {
    return routes.map(([id,label])=>`<a href="#${id}"${id===page?' aria-current="page"':''}>${label}</a>`).join('');
  }
  async function form(action, form, values) {
    if (action==='admin.filter') { search=values.search; status=values.status; return; }
    if (action==='admin.product') {
      const tiers = values.tiers.split('\n').map(t=>t.trim()).filter(Boolean).map(line=>{
        if (!/^\d+\s*:\s*\d+$/.test(line)) throw new Error('Use o formato quantidade:centavos em cada faixa.');
        const [minimum,cents]=line.split(':').map(Number);
        return {minimum,cents};
      });
      await api(action,{...values,retail_cents:values.retail?Math.round(Number(values.retail)*100):null,
        tiers,multiple:Number(values.multiple),until:values.until?new Date(values.until).toISOString():null,
        stockDelta:Number(values.stockDelta),active:values.active==='on'});
      if (location.hash==='#admin-novo-produto') location.hash='admin-produtos';
    } else if (action==='admin.delivery') {
      await api(action,{...values,id:form.dataset.id,freight_cents:values.freight?Math.round(Number(values.freight)*100):null});
    } else {
      await api(action,{...values,id:form.dataset.id});
    }
    notice('Alteração registrada.');
  }
  return {render,links,form,showCampaign};
}
