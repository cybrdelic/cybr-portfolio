const dialog = document.querySelector('#lightbox');
let gallery = [], active = 0, opener;
function showImage(index) {
  active = (index + gallery.length) % gallery.length;
  const link = gallery[active];
  const image = dialog.querySelector('img');
  image.src = link.querySelector('img').src;
  image.alt = link.dataset.label;
  dialog.querySelector('.viewer-caption').textContent = `${active + 1} / ${gallery.length} — ${link.dataset.label}`;
  dialog.querySelector('.original-link').href = link.href;
  dialog.querySelector('.original-link').textContent = link.getAttribute('href').startsWith('assets/') ? 'Open retained preview ↗' : 'Open original ↗';
}
document.querySelectorAll('.zoom').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  opener = link;
  const container = link.closest('.render-grid, .index-grid, .detail-cover, .score-art');
  gallery = [...container.querySelectorAll('.zoom')].filter(item => !item.closest('[hidden]'));
  showImage(gallery.indexOf(link));
  dialog.showModal();
}));
dialog.querySelector('.close-view').addEventListener('click', () => dialog.close());
dialog.querySelector('.prev-view').addEventListener('click', () => showImage(active - 1));
dialog.querySelector('.next-view').addEventListener('click', () => showImage(active + 1));
dialog.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); showImage(active - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); showImage(active + 1); }
});
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => opener?.focus());
const items = [...document.querySelectorAll('.index-item')];
let selectedFilter = 'all';
function filterGallery(value) {
  selectedFilter = value;
  const query = document.querySelector('#render-search')?.value.trim().toLowerCase() || '';
  items.forEach(item => { item.hidden = (value !== 'all' && item.dataset.project !== value) || !item.textContent.toLowerCase().includes(query); });
  document.querySelectorAll('[data-filter]').forEach(button => {
    const selected = button.dataset.filter === value;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const status = document.querySelector('#filter-status');
  if (status) status.textContent = `${items.filter(item => !item.hidden).length} renders and studies · select an image to explore`;
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => filterGallery(button.dataset.filter)));
document.querySelector('#render-search')?.addEventListener('input', () => filterGallery(selectedFilter));
filterGallery('all');
document.querySelectorAll('.compare-control input').forEach(input => input.addEventListener('input', () => {
  const section = input.closest('.compare-section');
  section.querySelector('.compare-frame').style.setProperty('--split', `${input.value}%`);
  section.querySelector('output').textContent = `${input.value}%`;
}));
document.querySelectorAll('[data-feature]').forEach(button => button.addEventListener('click', () => {
  const image = document.querySelector('#feature-image');
  image.src = button.dataset.feature;
  image.alt = button.dataset.caption;
  document.querySelector('#feature-link').href = button.dataset.destination;
  document.querySelector('#feature-caption').textContent = button.dataset.caption;
  document.querySelectorAll('[data-feature]').forEach(choice => {
    const active = choice === button;
    choice.classList.toggle('active', active);
    choice.setAttribute('aria-pressed', String(active));
  });
}));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.project-menu[open], .mobile-menu[open]').forEach(menu => menu.removeAttribute('open'));
});
