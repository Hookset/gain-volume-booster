// Applies the cached popup theme before first paint to avoid a light/dark flash.
(function () {
  try {
    if (localStorage.getItem('gain.darkMode') !== 'true') return;
    document.documentElement.classList.add('dark');
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.getElementById('btnDark');
      if (btn) btn.textContent = '☀️';
    });
  } catch (e) {}
})();
