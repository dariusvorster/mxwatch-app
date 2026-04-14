(function () {
  try {
    var s = localStorage.getItem('mxwatch-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = s === 'dark' || (s !== 'light' && prefersDark);
    if (useDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
