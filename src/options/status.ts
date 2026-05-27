const statusEl = document.getElementById('status')!;
let _timer: ReturnType<typeof setTimeout> | undefined;

export function showStatus(message: string, type: string): void {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  requestAnimationFrame(() => { statusEl.classList.add('show'); });
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    statusEl.classList.remove('show');
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'status'; }, 300);
  }, 3000);
}
