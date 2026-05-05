// Applies the cached Settings theme before first paint to avoid a light/dark flash.
(function () {
  try {
    const darkMode = localStorage.getItem('gain.darkMode');
    if (darkMode === 'true') {
      document.documentElement.classList.add('dark');
      return;
    }

    if (darkMode === 'false') {
      return;
    }
  } catch (e) {}

  document.documentElement.classList.add('theme-loading');
})();
