(function() {
  var theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.background = theme === 'dark' ? '#111113' : '#ffffff';
})();
