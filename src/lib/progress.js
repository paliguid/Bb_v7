const KEY = 'breadbai.progress.v1';

/** Which lessons the person has finished. Storage can be blocked (private mode), so never throw. */
export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveProgress(progress) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* progress just won't persist — not worth interrupting a lesson */
  }
}
