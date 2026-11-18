/**
 * Toast Notifications & Modal Helper
 */

export function showToast(message, type = 'info', durationMs = 2600) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, durationMs);
}

export function openModal(title, contentElOrHtml) {
  const backdrop = document.getElementById('modal-backdrop');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  if (!backdrop || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML = '';
  if (typeof contentElOrHtml === 'string') {
    bodyEl.innerHTML = contentElOrHtml;
  } else if (contentElOrHtml instanceof HTMLElement) {
    bodyEl.appendChild(contentElOrHtml);
  }
  backdrop.classList.remove('hidden');
}

export function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) backdrop.classList.add('hidden');
}
