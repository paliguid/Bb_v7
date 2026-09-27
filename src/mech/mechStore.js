import { useCallback, useReducer, useRef } from 'react';
import { cloneAssembly, newAssembly } from './assembly.js';

const KEY = 'breadbai.mech.v1';
const LIMIT = 100;

function load() {
  try { const raw = window.localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (Array.isArray(d.parts)) { d.systemLinks ??= []; return d; } } } catch { /* corrupt or blocked */ }
  return newAssembly();
}

/** Same shape as usePcbDoc: undo/redo history plus autosave, for the mechanism document. */
export function useMechDoc() {
  const docRef = useRef(null);
  if (docRef.current === null) docRef.current = load();
  const past = useRef([]); const future = useRef([]); const timer = useRef(0);
  const [, bump] = useReducer((n) => n + 1, 0);
  const getDoc = useCallback(() => docRef.current, []);

  const persist = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { try { window.localStorage.setItem(KEY, JSON.stringify(docRef.current)); } catch { /* quota */ } }, 400);
  }, []);
  const set = useCallback((next) => { docRef.current = next; bump(); persist(); }, [persist]);
  const update = useCallback((fn) => { const next = cloneAssembly(docRef.current); fn(next); set(next); }, [set]);
  const mark = useCallback(() => { past.current.push(docRef.current); if (past.current.length > LIMIT) past.current.shift(); future.current = []; }, []);
  const commit = useCallback((fn) => { mark(); update(fn); }, [mark, update]);
  const replace = useCallback((doc) => { mark(); set(doc); }, [mark, set]);
  const undo = useCallback(() => { if (!past.current.length) return; future.current.push(docRef.current); set(past.current.pop()); }, [set]);
  const redo = useCallback(() => { if (!future.current.length) return; past.current.push(docRef.current); set(future.current.pop()); }, [set]);
  const reset = useCallback((doc) => { past.current = []; future.current = []; set(doc ?? newAssembly()); }, [set]);

  return { doc: docRef.current, getDoc, update, mark, commit, replace, reset, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
