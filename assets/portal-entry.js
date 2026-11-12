// Preserve the storefront demonstration while the real portal is disabled.
fetch('/api/portal', {headers:{Accept:'application/json'}}).then(response => response.ok ? response.json() : null).then(config => {
  if (!config?.enabled) return;
  const header = document.getElementById('ul')?.closest('button');
  if (!header) return;
  const title = document.getElementById('ul');
  title.textContent = 'Minha conta';
  const intro = document.querySelector('.intro-act');
  if (intro) {
    const link = document.createElement('a');
    link.className = 'btn btn-o';
    link.href = '/minha-conta#produtos';
    link.textContent = 'Comprar pelo portal';
    intro.append(link);
  }
  header.addEventListener('click',event => {
    event.stopImmediatePropagation();
    location.assign('/minha-conta');
  },true);
}).catch(() => {});
