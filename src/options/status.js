// status.js — 全局状态提示条（toast）

const statusEl = document.getElementById('status');

let _timer = null;

export function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  requestAnimationFrame(() => {
    statusEl.classList.add('show');
  });
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    statusEl.classList.remove('show');
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, 300);
  }, 3000);
}
