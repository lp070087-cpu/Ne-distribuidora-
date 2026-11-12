(() => {
  'use strict';

  const launcher = document.querySelector('[data-warehouse-launch]');
  if (!launcher) return;

  const racks = ['A', 'B', 'C', 'D'].flatMap((aisle, row) => Array.from({ length: 4 }, (_, col) => ({
    id: `${aisle}${col + 1}`, aisle, shelf: col + 1, x: -11.4 + col * 5.5, z: -6 + row * 3.8,
  })));
  const products = [
    { name: 'Creatina Max Titanium 300 g', sku: 'DEMO-001', rack: 'C4', level: 2, quantity: 18 },
    { name: 'Whey Protein 900 g', sku: 'DEMO-002', rack: 'A1', level: 1, quantity: 12 },
    { name: 'Pré-treino 300 g', sku: 'DEMO-003', rack: 'B2', level: 3, quantity: 6 },
    { name: 'Barras proteicas', sku: 'DEMO-004', rack: 'D3', level: 1, quantity: 3 },
    { name: 'Coqueteleira 600 ml', sku: 'DEMO-005', rack: 'A3', level: 2, quantity: 0 },
    { name: 'Multivitamínico', sku: 'DEMO-006', rack: '', level: 0, quantity: 5 },
  ];
  const orders = [{ id: 'DEMO-1042', items: [
    { sku: 'DEMO-002', quantity: 2 }, { sku: 'DEMO-003', quantity: 3 }, { sku: 'DEMO-001', quantity: 1 },
    { sku: 'DEMO-005', quantity: 1 }, { sku: 'DEMO-004', quantity: 4 }, { sku: 'DEMO-006', quantity: 1 },
  ] }];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const locationName = rack => `Corredor ${rack.aisle} · Estante ${String(rack.shelf).padStart(2, '0')}`;
  const rackFor = id => racks.find(rack => rack.id === id);
  const scale = { low: 1, medium: 1.35, high: 2 };
  const cameraStart = { azimuth: 0.7, elevation: 0.65, distance: 35, x: 0, z: 0 };
  const camera = { ...cameraStart };
  const occupied = products.filter(product => product.rack && product.quantity > 0).length;
  const capacity = racks.length * 3;
  let dialog, canvas, ctx, mode, quality, selection, selectedProduct, selectedOrder, observer, drawFrame;
  let hits = [];

  function open() {
    if (!dialog) mount();
    dialog.showModal();
    observer.observe(canvas);
    draw();
  }

  function mount() {
    dialog = document.createElement('dialog');
    dialog.className = 'wh-dialog';
    dialog.setAttribute('aria-labelledby', 'wh-title');
    dialog.innerHTML = `
      <div class="wh-shell">
        <header class="wh-head"><div><span class="wh-demo">Demonstração</span><h2 id="wh-title">Centro de Distribuição 3D</h2><p>Explore o galpão e simule uma separação. As posições, quantidades e pedidos são exemplos.</p></div><button type="button" class="wh-close" data-action="close" aria-label="Fechar centro de distribuição">Fechar</button></header>
        <div class="wh-actions" aria-label="Modo de visualização"><button type="button" data-action="3d" aria-pressed="true">Perspectiva 3D</button><button type="button" data-action="2d" aria-pressed="false">Planta 2D</button><label class="sr" for="wh-quality">Qualidade gráfica</label><select id="wh-quality" aria-label="Qualidade gráfica"><option value="low">Qualidade baixa</option><option value="medium" selected>Qualidade média</option><option value="high">Qualidade alta</option></select></div>
        <div class="wh-layout">
          <div class="wh-stage"><canvas class="wh-canvas" tabindex="0" aria-label="Mapa interativo do armazém. Arraste para girar ou use os controles abaixo."></canvas>
            <div class="wh-controls" aria-label="Controles da câmera"><button type="button" data-action="left" aria-label="Girar à esquerda">↶</button><button type="button" data-action="right" aria-label="Girar à direita">↷</button><button type="button" data-action="in" aria-label="Aproximar">+</button><button type="button" data-action="out" aria-label="Afastar">−</button><button type="button" data-action="pan" aria-pressed="false">Deslocar</button><button type="button" data-action="reset">Câmera inicial</button></div><div class="wh-legend">Doca 01 · Recebimento &nbsp; Doca 02 · Expedição</div>
          </div>
          <aside class="wh-panel"><h3>Localizar no galpão</h3>
            <label for="wh-search">Produto ou SKU</label><input id="wh-search" type="search" placeholder="Ex. Creatina" autocomplete="off"><div class="wh-results" id="wh-results"></div>
            <label for="wh-aisle">Corredor</label><select id="wh-aisle"><option value="">Selecione um corredor</option>${['A','B','C','D'].map(aisle => `<option>${aisle}</option>`).join('')}</select>
            <label for="wh-rack">Estante</label><select id="wh-rack" disabled><option value="">Selecione um corredor primeiro</option></select>
            <div class="wh-detail" id="wh-detail" role="status">Selecione uma estante ou pesquise um produto.</div>
            <label for="wh-order">Pedido de separação</label><select id="wh-order"><option value="">Selecione um pedido</option>${orders.map(order => `<option>${order.id}</option>`).join('')}</select>
            <div id="wh-order-list" aria-live="polite"></div>
          </aside>
        </div>
        <div class="wh-stats" aria-label="Indicadores simulados"><div class="wh-stat">Posições ocupadas<strong>${occupied} de ${capacity}</strong></div><div class="wh-stat">Capacidade da planta<strong>${capacity} níveis</strong></div><div class="wh-stat">Pedidos pendentes<strong id="wh-pending">${orders.length}</strong></div><div class="wh-stat">Em separação<strong id="wh-picking">0</strong></div><div class="wh-stat">Divergências de quantidade<strong id="wh-divergences">0</strong></div><div class="wh-stat">Itens sem localização<strong>${products.filter(product => !product.rack).length}</strong></div></div>
        <p class="wh-note">Use as setas sobre o mapa para mover a vista. A sequência do pedido segue a ordem dos itens aptos para coleta.</p>
      </div>`;
    document.body.append(dialog);
    canvas = dialog.querySelector('canvas');
    ctx = canvas.getContext('2d');
    mode = '3d';
    quality = 'medium';
    observer = new ResizeObserver(draw);
    dialog.addEventListener('close', () => {
      observer.disconnect();
      cancelAnimationFrame(drawFrame);
      drawFrame = null;
    });
    dialog.addEventListener('click', click);
    field('quality').addEventListener('change', event => { quality = event.target.value; draw(); });
    field('search').addEventListener('input', search);
    field('aisle').addEventListener('change', event => chooseAisle(event.target.value));
    field('rack').addEventListener('change', event => chooseRack(rackFor(event.target.value)));
    field('order').addEventListener('change', event => selectOrder(orders.find(order => order.id === event.target.value)));
    bindCanvas();
  }

  function field(name) { return dialog.querySelector(`#wh-${name}`); }

  function click(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.sku) { chooseProduct(products.find(product => product.sku === button.dataset.sku)); return; }
    const action = button.dataset.action;
    if (action === 'close') { dialog.close(); return; }
    if (action === '3d' || action === '2d') {
      mode = action;
      for (const view of ['2d', '3d']) dialog.querySelector(`[data-action="${view}"]`).setAttribute('aria-pressed', String(mode === view));
      for (const rotate of ['left', 'right']) dialog.querySelector(`[data-action="${rotate}"]`).disabled = mode === '2d';
    }
    if (action === 'left' || action === 'right') camera.azimuth += action === 'left' ? -.18 : .18;
    if (action === 'in' || action === 'out') zoom(action === 'in' ? .86 : 1.16);
    if (action === 'pan') button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') === 'false'));
    if (action === 'reset') Object.assign(camera, cameraStart);
    draw();
  }

  function search(event) {
    const term = normalize(event.target.value.trim());
    const matches = term ? products.filter(product => normalize(`${product.name} ${product.sku}`).includes(term)) : [];
    field('results').innerHTML = matches.map(product => `<button type="button" data-sku="${product.sku}">${product.name}</button>`).join('') || (term ? '<p class="wh-note">Nenhum produto demonstrativo encontrado.</p>' : '');
  }

  function chooseAisle(aisle) {
    const options = racks.filter(rack => rack.aisle === aisle);
    const rackInput = field('rack');
    rackInput.disabled = !aisle;
    rackInput.innerHTML = `<option value="">${aisle ? 'Selecione uma estante' : 'Selecione um corredor primeiro'}</option>${options.map(rack => `<option value="${rack.id}">Estante ${String(rack.shelf).padStart(2, '0')}</option>`).join('')}`;
    selection = aisle ? { aisle } : null;
    selectedProduct = null;
    if (options.length) { camera.x = 0; camera.z = options[0].z * .7; }
    updateDetails();
    draw();
  }

  function chooseRack(rack) {
    if (!rack) { chooseAisle(field('aisle').value); return; }
    if (field('aisle').value !== rack.aisle) { field('aisle').value = rack.aisle; chooseAisle(rack.aisle); }
    field('rack').value = rack.id;
    selection = rack;
    selectedProduct = null;
    camera.x = clamp(rack.x * .82, -10, 10);
    camera.z = clamp(rack.z * .82, -7, 7);
    updateDetails();
    draw();
  }

  function chooseProduct(product) {
    if (product.rack) chooseRack(rackFor(product.rack));
    else { field('aisle').value = ''; chooseAisle(''); }
    selectedProduct = product;
    updateDetails();
  }

  function updateDetails() {
    const rackProducts = selection?.id ? products.filter(product => product.rack === selection.id) : [];
    const text = selectedProduct ? `${selectedProduct.name} · ${selectedProduct.rack ? `${locationName(selection)} · Nível ${String(selectedProduct.level).padStart(2, '0')}` : 'Sem localização cadastrada na demo'} · ${selectedProduct.quantity} un. na simulação` :
      selection?.id ? `${locationName(selection)} · 3 níveis · ${rackProducts.length} produto(s) da simulação` : selection ? `Corredor ${selection.aisle} · 4 estantes` : 'Selecione uma estante ou pesquise um produto.';
    field('detail').textContent = text;
  }

  function orderItems() {
    return selectedOrder ? selectedOrder.items.map(item => ({ ...item, product: products.find(product => product.sku === item.sku) })) : [];
  }

  function selectOrder(order) {
    selectedOrder = order;
    let next = 0, issues = 0, divergences = 0;
    const rows = orderItems().map(({ product, quantity }) => {
      let status;
      if (!product.rack) status = 'Sem localização';
      else if (product.quantity === 0) status = 'Indisponível';
      else if (product.quantity < quantity) { status = `Divergência · ${product.quantity} de ${quantity} un.`; divergences++; }
      else status = `Coleta ${++next} · ${locationName(rackFor(product.rack))} · Nível ${product.level}`;
      if (!status.startsWith('Coleta')) issues++;
      return `<li>${product.name} · ${quantity} un.<br><strong>${status}</strong></li>`;
    });
    field('order-list').innerHTML = order ? `<p class="wh-note">${issues} ocorrência(s) na simulação</p><ol>${rows.join('')}</ol>` : '';
    field('pending').textContent = String(orders.length - Number(Boolean(order)));
    field('picking').textContent = order ? '1' : '0';
    field('divergences').textContent = String(divergences);
    draw();
  }

  function bindCanvas() {
    let previous = null;
    const touches = new Map();
    canvas.addEventListener('pointerdown', event => {
      canvas.setPointerCapture(event.pointerId);
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      previous = { x: event.clientX, y: event.clientY, drag: touches.size > 1 };
    });
    canvas.addEventListener('pointermove', event => {
      if (!previous || !touches.has(event.pointerId)) return;
      const before = touches.get(event.pointerId);
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        const other = [...touches.entries()].find(([id]) => id !== event.pointerId)[1];
        const oldDistance = Math.hypot(before.x - other.x, before.y - other.y);
        const newDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (oldDistance > 10 && newDistance > 10) zoom(oldDistance / newDistance);
        return;
      }
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      if (!previous.drag && Math.hypot(dx, dy) < 4) return;
      previous = { x: event.clientX, y: event.clientY, drag: true };
      if (mode === '2d' || event.shiftKey || dialog.querySelector('[data-action="pan"]').getAttribute('aria-pressed') === 'true') pan(dx, dy);
      else { camera.azimuth -= dx * .01; camera.elevation = clamp(camera.elevation + dy * .009, .27, 1.46); draw(); }
    });
    canvas.addEventListener('pointerup', event => {
      if (previous && !previous.drag) {
        const bounds = canvas.getBoundingClientRect();
        const match = [...hits].reverse().find(hit => inside(event.clientX - bounds.left, event.clientY - bounds.top, hit.points));
        if (match) chooseRack(match.rack);
      }
      touches.delete(event.pointerId);
      const remaining = touches.values().next().value;
      previous = remaining ? { ...remaining, drag: true } : null;
    });
    canvas.addEventListener('pointercancel', () => { touches.clear(); previous = null; });
    canvas.addEventListener('wheel', event => { event.preventDefault(); zoom(Math.exp(clamp(event.deltaY, -120, 120) * .003)); }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const move = { ArrowLeft: [18, 0], ArrowRight: [-18, 0], ArrowUp: [0, 18], ArrowDown: [0, -18] }[event.key];
      if (!move) return;
      event.preventDefault();
      pan(...move);
    });
  }

  function pan(dx, dy) {
    const amount = camera.distance / 580;
    const azimuth = mode === '2d' ? 0 : camera.azimuth;
    camera.x = clamp(camera.x - amount * (dx * Math.cos(azimuth) - dy * Math.sin(azimuth)), -12, 12);
    camera.z = clamp(camera.z + amount * (dx * Math.sin(azimuth) + dy * Math.cos(azimuth)), -9, 9);
    draw();
  }

  function zoom(amount) { camera.distance = clamp(camera.distance * amount, 19, 67); draw(); }

  function inside(x, y, points) {
    return points.reduce((result, point, index) => {
      const previous = points[(index + points.length - 1) % points.length];
      return (point.y > y) !== (previous.y > y) && x < (previous.x - point.x) * (y - point.y) / (previous.y - point.y) + point.x ? !result : result;
    }, false);
  }

  function project(width, height) {
    if (mode === '2d') {
      const unit = Math.min(width / 32, height / 22) * 35 / camera.distance;
      return (x, y, z) => ({ x: width * .5 + (x - camera.x) * unit, y: height * .49 + (z - camera.z) * unit, depth: 0 });
    }
    const ca = Math.cos(camera.azimuth), sa = Math.sin(camera.azimuth), ce = Math.cos(camera.elevation), se = Math.sin(camera.elevation);
    const focal = Math.min(width * .96, height * 1.21);
    return (x, y, z) => {
      const dx = x - camera.x, dz = z - camera.z, dy = y - .7;
      const depth = Math.max(4, camera.distance - (dx * sa + dz * ca) * ce - dy * se);
      return { x: width * .5 + (dx * ca - dz * sa) * focal / depth, y: height * .50 + ((dx * sa + dz * ca) * se - dy * ce) * focal / depth, depth };
    };
  }

  function draw() {
    if (!dialog?.open || drawFrame) return;
    drawFrame = requestAnimationFrame(() => { drawFrame = null; render(); });
  }

  function render() {
    if (!ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(Math.max(devicePixelRatio || 1, 1.25), scale[quality]);
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#201e1c'; ctx.fillRect(0, 0, width, height);
    const p = project(width, height);
    const rectangle = (x, z, w, d, y = 0) => [p(x, y, z), p(x + w, y, z), p(x + w, y, z + d), p(x, y, z + d)];
    hits = [];

    function polygon(points, fill, stroke = '#353332') {
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }

    function line(points, color, lineWidth = 1) {
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
    }

    function label(text, at, color = '#f4ebdf', size = 11) {
      ctx.font = `700 ${size}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, at.x, at.y);
    }

    polygon(rectangle(-13.5, -8.5, 28, 19), '#494440', '#9e8b7b');
    for (let x = -12; x <= 14; x += 2) line([p(x, .01, -8.5), p(x, .01, 10.5)], '#56504b');
    for (let z = -8; z <= 10; z += 2) line([p(-13.5, .01, z), p(14.5, .01, z)], '#56504b');
    polygon(rectangle(-12.5, 7.3, 10, 2.8, .02), '#4d6a5b');
    polygon(rectangle(2.5, 7.3, 10, 2.8, .02), '#735c47');
    label('RECEBIMENTO', p(-7.5, .03, 8.6), '#e8f3e9', width < 460 ? 8 : 10);
    label('EXPEDIÇÃO', p(7.5, .03, 8.6), '#fff1dd', width < 460 ? 8 : 10);

    const route = orderItems().filter(({ product, quantity }) => product.rack && product.quantity >= quantity).map(({ product }) => rackFor(product.rack));
    if (route.length) {
      const points = [p(13.1, .08, 8.5)];
      for (const rack of route) points.push(p(13.1, .08, rack.z + 2.25), p(rack.x + 1.5, .08, rack.z + 2.25), p(13.1, .08, rack.z + 2.25));
      points.push(p(13.1, .08, 8.5));
      ctx.setLineDash([5, 4]); line(points, '#ffc18e', 2); ctx.setLineDash([]);
    }

    const faces = [];
    function cuboid(x, y, z, w, h, d, colors, rack) {
      const bottom = rectangle(x, z, w, d, y), top = rectangle(x, z, w, d, y + h);
      const add = (points, fill) => faces.push({ points, fill, rack, depth: points.reduce((total, point) => total + point.depth, 0) / points.length });
      add(top, colors[0]);
      for (let side = 0; side < 4; side++) { const next = (side + 1) % 4; add([bottom[side], bottom[next], top[next], top[side]], colors[1 + side % 2]); }
    }

    if (mode === '3d') {
      const structure = ['#938579', '#6d6057', '#817267'];
      for (const z of [-8.35, 10.15]) {
        for (const x of [-13.25, -6.5, 0, 6.5, 13.7]) cuboid(x, 0, z, .26, 4.1, .22, structure);
        cuboid(-13.25, 3.9, z, 27.2, .19, .22, structure);
      }
      for (const x of [-13.25, 13.7]) cuboid(x, 3.9, -8.35, .22, .19, 18.7, structure);
      for (const x of [-8.6, 6.2]) {
        cuboid(x, .15, 10.5, 2.1, 1.05, 2.05, ['#d2a587', '#a4775b', '#b78969']);
        cuboid(x, .12, 12.55, 2.1, .7, .75, ['#eedfce', '#ac9e8d', '#cabda9']);
      }
    }

    for (const rack of racks) {
      const active = selection?.id === rack.id || (!selection?.id && selection?.aisle === rack.aisle), routeItem = route.includes(rack);
      if (mode === '2d') {
        const points = rectangle(rack.x, rack.z, 3.2, 1.6);
        polygon(points, active ? '#dba982' : routeItem ? '#805536' : '#6c665f', active || routeItem ? '#ffc18e' : '#afa398');
        label(rack.id, p(rack.x + 1.6, 0, rack.z + .8), active ? '#211814' : '#fff');
        hits.push({ points, rack });
        continue;
      }
      const colors = active ? ['#e2b28d', '#966b4a', '#b78763'] : routeItem ? ['#cf9b71', '#8a6345', '#a47654'] : ['#aaa29b', '#625a53', '#81756c'];
      for (const x of [rack.x, rack.x + 2.98]) for (const z of [rack.z, rack.z + 1.33]) cuboid(x, 0, z, .14, 2.76, .14, colors, rack);
      for (const y of [.12, .94, 1.76, 2.59]) cuboid(rack.x, y, rack.z, 3.13, .09, 1.47, colors, rack);
      const levels = quality === 'low' ? [.21, 1.85] : [.21, 1.03, 1.85];
      for (const y of levels) for (const x of [.26, 1.35, 2.32]) {
        const boxColors = active ? ['#efca9e', '#a67850', '#c39162'] : ['#be9d75', '#8a6a48', '#a98257'];
        cuboid(rack.x + x, y, rack.z + .21, .59, .53, .77, boxColors, rack);
      }
    }
    faces.sort((left, right) => right.depth - left.depth);
    for (const face of faces) { polygon(face.points, face.fill, '#302821'); if (face.rack) hits.push(face); }
    for (const aisle of ['A', 'B', 'C', 'D']) {
      const rack = racks.find(item => item.aisle === aisle);
      label(`CORREDOR ${aisle}`, p(-10.4, .04, rack.z + 2.48), selection?.aisle === aisle ? '#ffd4a9' : '#f4ebdf', width < 460 ? 8 : 10);
    }
    if (mode === '3d' && selection?.id) label(selection.id, p(selection.x + 1.55, 3.02, selection.z + .72), '#ffd4a9', 14);
  }

  launcher.addEventListener('click', open);
})();
