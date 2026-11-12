(function () {
  'use strict';

  const campaign = window.NE_CAMPAIGN || [];
  const now = new Date();
  const available = campaign.filter(function (offer) {
    return !offer.expiresAt || now <= new Date(offer.expiresAt);
  }).map(function (offer) {
    if (!offer.lots) return offer;
    const lots = offer.lots.filter(function (lot) { return now <= new Date(lot.expiresAt); });
    return { ...offer, notes: [offer.notes, ...lots.map(function (lot) { return lot.label; })].filter(Boolean).join(' · ') };
  });
  const escape = NE.esc;
  const money = NE.money;
  const hero = document.getElementById('inicio');
  const track = hero?.querySelector('.hero-tr');
  const grid = document.getElementById('campaign-grid');
  const filters = document.getElementById('campaign-filters');
  const more = document.getElementById('campaign-more');
  const search = document.getElementById('campaign-search');
  const directory = document.getElementById('campaign-categories');
  const offersPage = document.body.dataset.view === 'offers';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pageSize = offersPage ? 24 : 12;
  const url = new URL(location.href);
  let filter = ['product', 'combo'].includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : 'all';
  let category = url.searchParams.get('categoria') || '';
  let brand = url.searchParams.get('marca') || '';
  let range = url.searchParams.get('preco') || '';
  let limit = pageSize;
  let slide = 0;
  let paused = motion.matches;
  let pointerStart;

  function price(offer) {
    return money(offer.tiers[0].cash);
  }

  function bannerProduct(offer) {
    return offer.image ? { image: offer.image, alt: offer.n } : null;
  }

  const mainOffer = available.find(function (offer) { return offer.featured === 'campaign'; });
  const combo = available.find(function (offer) { return offer.featured === 'combo'; });
  const featured = available.find(function (offer) { return offer.featured === 'product'; });
  const slides = [mainOffer && {
    kicker: 'Black Friday NE', title: 'Ofertas para revenda',
    text: mainOffer.n + ' por ' + money(mainOffer.tiers[0].cash) + ' à vista por unidade, em múltiplos de 8.',
    cta: 'Ver ofertas', href: '#ofertas', art: bannerProduct(mainOffer), tone: 'light'
  }, combo && {
    kicker: 'Black Friday NE', title: 'Combos para a sua loja',
    text: 'Lilith, Precious e Nun com coqueteleira de 1 L de brinde. ' + money(combo.tiers[0].cash) + ' à vista por combo.',
    cta: 'Ver combos', href: '#ofertas', filter: 'combo', art: bannerProduct(combo), tone: 'light'
  }, featured && {
    kicker: featured.br || 'Destaque da campanha', title: featured.n,
    text: price(featured) + ' à vista ' + featured.tiers[0].condition.toLowerCase() + '. Consulte a disponibilidade.',
    cta: 'Ver condição', href: '#oferta-' + featured.id, art: bannerProduct(featured), tone: 'light'
  }, {
    kicker: 'Suplementos no atacado', title: 'Planeje sua próxima reposição',
    text: 'Explore proteínas, creatinas e pré-treinos para o mix da sua loja.',
    cta: 'Explorar categorias', href: '#cat',
    art: { image: 'Public/suplementos/Creatina/CREATINA___300G___MAX_TITANIUM___AMINOACIDO_768adf8_thumb.webp', alt: 'Pote de creatina Max Titanium 300 g' }, tone: 'warm'
  }].filter(Boolean);

  function media(offer) {
    if (offer.image) return '<div class="campaign-media campaign-media-cutout"><img src="' + escape(offer.image) + '" alt="' + escape(offer.n) + '" loading="lazy" decoding="async"></div>';
    if (!offer.sprite) return '';
    const { file, index, columns, rows } = offer.sprite;
    const x = (index % columns) * 100 / (columns - 1);
    const y = Math.floor(index / columns) * 100 / (rows - 1);
    return '<div class="campaign-media" aria-hidden="true"><div class="campaign-sprite" style="background-image:url(' + escape(file) + ');background-size:' + (columns * 100) + '% ' + (rows * 100) + '%;background-position:' + x + '% ' + y + '%"></div></div>';
  }

  function normalize(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function categoryOf(offer) {
    if (offer.kind === 'combo') return 'Combos e kits';
    const groups = {
      'Proteínas': 'Proteínas e whey',
      'Vitaminas e Saúde': 'Vitaminas e minerais',
      'Termogênicos e L-carnitina': 'Termogênicos e L-carnitina',
      'Endurance e Hidratação': 'Energia e hidratação',
      'Barrinhas e Snacks': 'Barras e snacks'
    };
    if (offer.cat === 'Creatinas e Aminoácidos') return /creatina/i.test(offer.n) ? 'Creatinas' : 'Aminoácidos';
    return groups[offer.cat] || offer.cat;
  }

  const categories = [...new Set(available.map(categoryOf))].sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  const brands = [...new Set(available.flatMap(function (offer) { return offer.br.split(' + '); }))].sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  const ranges = { ate50: [0, 50], ate100: [50, 100], acima100: [100, Infinity] };
  if (!categories.includes(category)) category = '';
  if (!brands.includes(brand)) brand = '';
  if (!Object.hasOwn(ranges, range)) range = '';
  search.value = url.searchParams.get('q') || '';

  function offersLink(extra = {}) {
    const state = { tipo: filter === 'all' ? '' : filter, categoria: category, marca: brand, preco: range, q: search.value.trim(), ...extra };
    const query = new URLSearchParams(Object.entries(state).filter(function (entry) { return entry[1]; })).toString();
    return '/ofertas' + (query ? '?' + query : '');
  }

  function options(values, selected) {
    return values.map(function ([value, label]) {
      return '<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(label) + '</option>';
    }).join('');
  }

  const facets = document.createElement('div');
  facets.className = 'campaign-facets';
  facets.innerHTML = '<label>Categoria<select id="offer-category" class="fi fs">' + options([['', 'Todas as categorias'], ...categories.map(function (item) { return [item, item]; })], category) + '</select></label>' +
    '<label>Marca<select id="offer-brand" class="fi fs">' + options([['', 'Todas as marcas'], ...brands.map(function (item) { return [item, item]; })], brand) + '</select></label>' +
    '<label>Preço à vista<select id="offer-price" class="fi fs">' + options([['', 'Todos os preços'], ['ate50', 'Abaixo de R$ 50'], ['ate100', 'De R$ 50 a R$ 99,99'], ['acima100', 'R$ 100 ou mais']], range) + '</select></label>';
  filters.before(facets);
  const categorySelect = facets.querySelector('#offer-category');
  const brandSelect = facets.querySelector('#offer-brand');
  const rangeSelect = facets.querySelector('#offer-price');

  function resetFacets() {
    search.value = categorySelect.value = brandSelect.value = rangeSelect.value = '';
    category = brand = range = '';
  }

  if (directory) directory.innerHTML = categories.map(function (item) {
    const total = available.filter(function (offer) { return categoryOf(offer) === item; }).length;
    return '<a href="' + escape(offersLink({ tipo: '', categoria: item, marca: '', preco: '', q: '' })) + '"><strong>' + escape(item) + '</strong><span>' + total + (total === 1 ? ' oferta' : ' ofertas') + ' ' + NE.ic('arrow', 'ic-sm') + '</span></a>';
  }).join('');

  function renderCards() {
    const query = normalize(search.value.trim());
    const selected = available.filter(function (offer) {
      const group = categoryOf(offer);
      const amount = offer.tiers[0].cash;
      return (filter === 'all' || offer.kind === filter) && (!category || group === category) &&
        (!brand || offer.br.split(' + ').includes(brand)) && (!range || amount >= ranges[range][0] && amount < ranges[range][1]) &&
        normalize([offer.n, offer.br, offer.cat, group, offer.notes].join(' ')).includes(query);
    });
    grid.innerHTML = selected.slice(0, limit).map(function (offer) {
      const original = Number.isFinite(offer.original) ? '<s aria-label="Preço anterior">' + money(offer.original) + '</s>' : '';
      const main = offer.tiers[0];
      const tiers = offer.tiers.slice(1).map(function (tier) {
        const card = Number.isFinite(tier.card) ? ' · ' + money(tier.card) + ' no cartão' : '';
        return '<div><dt>' + escape(tier.condition) + '</dt><dd>' + money(tier.cash) + ' à vista' + card + '</dd></div>';
      }).join('');
      const storeLink = offer.kind === 'combo' ? 'https://www.nedistribuidora.com.br/' : 'https://www.nedistribuidora.com.br/busca?q=' + encodeURIComponent(offer.n);
      return '<article class="campaign-card" id="oferta-' + escape(offer.id) + '" tabindex="-1">' + media(offer) +
        '<div class="campaign-heading"><p class="campaign-meta">' + escape([offer.br, categoryOf(offer)].filter(Boolean).join(' · ')) + '</p>' +
        '<h3>' + escape(offer.n) + '</h3></div>' +
        '<p class="campaign-price">' + original + '<strong>' + price(offer) + '</strong> <span>à vista</span></p>' +
        '<div class="campaign-details"><p class="campaign-condition">' + escape(main.condition) + '</p>' +
        (Number.isFinite(main.card) ? '<p class="campaign-note">' + money(main.card) + ' no cartão</p>' : '') +
        (tiers ? '<dl class="campaign-tiers" aria-label="Preços por volume">' + tiers + '</dl>' : '') +
        (offer.notes ? '<p class="campaign-note">' + escape(offer.notes) + '</p>' : '') + '</div>' +
        '<a class="btn btn-o campaign-action" href="' + escape(storeLink) + '" target="_blank" rel="noopener">Consultar oferta <span class="sr">' + escape(offer.n) + '</span></a></article>';
    }).join('') || '<div class="campaign-empty"><p>Nenhuma oferta corresponde aos filtros.</p><button type="button" class="btn btn-o" data-clear-offers>Limpar filtros</button></div>';
    filters.querySelectorAll('button').forEach(function (button) {
      const active = button.dataset.kind === filter;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.getElementById('campaign-count').textContent = selected.length + (selected.length === 1 ? ' oferta' : ' ofertas');
    more.hidden = offersPage ? limit >= selected.length : !selected.length;
    if (offersPage) history.replaceState(null, '', offersLink() + location.hash);
    else more.href = offersLink();
  }

  function revealOffer(hash) {
    if (!hash.startsWith('#oferta-')) return;
    const index = available.findIndex(function (offer) { return '#oferta-' + offer.id === hash; });
    if (index === -1) return;
    resetFacets();
    filter = 'all';
    limit = Math.max(pageSize, index + 1);
    renderCards();
    const target = document.getElementById(hash.slice(1));
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  }

  filters.addEventListener('click', function (event) {
    if (!event.target.dataset.kind) return;
    filter = event.target.dataset.kind;
    limit = pageSize;
    renderCards();
  });
  more.addEventListener('click', function (event) {
    if (!offersPage) {
      if (more.tagName === 'BUTTON') location.assign(offersLink());
      return;
    }
    event.preventDefault();
    const oldLimit = limit;
    limit += pageSize;
    renderCards();
    if (grid.children[oldLimit]) grid.children[oldLimit].focus({ preventScroll: true });
  });
  search.addEventListener('input', function () { limit = pageSize; renderCards(); });
  facets.addEventListener('change', function () {
    category = categorySelect.value;
    brand = brandSelect.value;
    range = rangeSelect.value;
    limit = pageSize;
    renderCards();
  });
  grid.addEventListener('click', function (event) {
    if (!event.target.closest('[data-clear-offers]')) return;
    resetFacets();
    filter = 'all';
    limit = pageSize;
    renderCards();
    search.focus();
  });
  renderCards();
  window.addEventListener('hashchange', function () { revealOffer(location.hash); });
  if (location.hash) requestAnimationFrame(function () { revealOffer(location.hash); });
  if (!track) return;

  track.innerHTML = slides.map(function (item, index) {
    return '<div class="hero-sl' + (index === 0 ? ' on' : '') + '" role="group" aria-roledescription="slide" aria-label="' + (index + 1) + ' de ' + slides.length + '" data-tone="' + item.tone + '"' + (index ? ' inert' : '') + '>' +
      '<div class="hero-inner"><div class="hero-copy"><p class="hero-kicker">' + escape(item.kicker) + '</p><h2 class="hero-title">' + escape(item.title) + '</h2><p>' + escape(item.text) + '</p>' +
      '<a class="btn btn-p" data-slide-link="' + index + '" href="' + escape(item.href) + '">' + escape(item.cta) + ' ' + NE.ic('arrow', 'ic-sm') + '</a></div>' +
      '<div class="hero-art"><img src="' + escape(item.art.image) + '" alt="' + escape(item.art.alt) + '" ' + (index ? 'loading="lazy"' : 'fetchpriority="high"') + ' decoding="async"></div></div></div>';
  }).join('') + (slides.length > 1 ? '<div class="hero-actions">' +
    '<button type="button" class="harr" data-step="-1" aria-label="Destaque anterior">' + NE.ic('left') + '</button>' +
    '<div class="hdots">' + slides.map(function (_, index) { return '<button type="button" class="hdot" data-slide="' + index + '" aria-label="Destaque ' + (index + 1) + '"></button>'; }).join('') + '</div>' +
    '<button type="button" class="harr" data-step="1" aria-label="Próximo destaque">' + NE.ic('right') + '</button>' +
    '<button type="button" class="hero-pause" aria-label="Pausar carrossel">Ⅱ</button></div>' : '');

  function setSlide(index) {
    slide = (index + slides.length) % slides.length;
    track.querySelectorAll('.hero-sl').forEach(function (item, position) {
      item.classList.toggle('on', position === slide);
      item.inert = position !== slide;
    });
    track.querySelectorAll('.hdot').forEach(function (item, position) {
      item.classList.toggle('on', position === slide);
      if (position === slide) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
  }

  const pause = track.querySelector('.hero-pause');
  function updatePause() {
    if (!pause) return;
    pause.hidden = motion.matches;
    pause.textContent = paused ? '▶' : 'Ⅱ';
    pause.setAttribute('aria-label', paused ? 'Retomar carrossel' : 'Pausar carrossel');
  }
  setSlide(0);
  updatePause();
  if (pause) pause.addEventListener('click', function () { paused = !paused; updatePause(); });
  motion.addEventListener('change', function () { paused = motion.matches; updatePause(); });

  track.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (button && button.dataset.step) setSlide(slide + Number(button.dataset.step));
    if (button && button.dataset.slide !== undefined) setSlide(Number(button.dataset.slide));
    const link = event.target.closest('[data-slide-link]');
    if (!link) return;
    const item = slides[Number(link.dataset.slideLink)];
    if (item.filter || item.href.startsWith('#oferta-')) {
      resetFacets();
      filter = item.filter || 'all';
      limit = item.filter ? pageSize : Math.max(pageSize, available.findIndex(function (offer) { return '#oferta-' + offer.id === item.href; }) + 1);
      renderCards();
    }
  });
  track.addEventListener('pointerdown', function (event) {
    pointerStart = event.pointerType === 'touch' ? [event.clientX, event.clientY] : null;
  });
  track.addEventListener('pointerup', function (event) {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart[0];
    const dy = event.clientY - pointerStart[1];
    pointerStart = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) setSlide(slide + (dx < 0 ? 1 : -1));
  });
  track.addEventListener('pointercancel', function () { pointerStart = null; });
  if (slides.length > 1) setInterval(function () {
    if (!paused && !document.hidden && !hero.matches(':hover, :focus-within')) setSlide(slide + 1);
  }, 8000);
}());
