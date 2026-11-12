// Preserve the storefront demonstration while the real portal is disabled.
fetch('/api/portal', {headers:{Accept:'application/json'}}).then(response => response.ok ? response.json() : null).then(config => {
  if (!config?.enabled) return;
  const header = document.getElementById('ul')?.closest('button');
  if (!header) return;
  const title = document.getElementById('ul');
  title.textContent = 'Minha conta';
  header.addEventListener('click',event => {
    event.stopImmediatePropagation();
    location.assign('/minha-conta');
  },true);
}).catch(() => {});
