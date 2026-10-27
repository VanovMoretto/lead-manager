// Aplica o tema salvo antes do React carregar, evitando o "flash" de tema claro
try {
  if (localStorage.getItem('gestao-leads-theme') === 'dark') {
    document.documentElement.classList.add('dark')
    document.documentElement.style.colorScheme = 'dark'
  }
} catch {}
