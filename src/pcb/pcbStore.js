import { useCallback, useReducer, useRef } from 'react';
import { cloneDoc, deserializePcb, newPcb, serializePcb } from './model.js';

const KEY = 'breadbai.pcb.v1';
const LIMIT = 100;

function load() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return deserializePcb(JSON.parse(raw));
  } catch { /* corrupt or blocked storage: start fresh */ }
  return newPcb();
}

/**
 * The PCB document with undo/redo and autosave.
 *   update(fn)  change the document without an undo step (use during drags)
 *   mark()      record an undo step for what is about to change
 *   commit(fn)  mark() + update(fn) — one undo step
 * Documents are treated as immutable: every change clones first, so old
 * versions on the undo stack are never touched.
 */
export function usePcbDoc() {
  const docRef = useRef(null);
  if (docRef.current === null) docRef.current = load();
  const past = useRef([]);
  const future = useRef([]);
  const timer = useRef(0);
  const [, bump] = useReducer((n) => n + 1, 0);

  const persist = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { window.localStorage.setItem(KEY, serializePcb(docRef.current)); } catch { /* quota / private mode */ }
    }, 400);
  }, []);

  const getDoc = useCallback(() => docRef.current, []);

  const set = useCallback((next) => { docRef.current = next; bump(); persist(); }, [persist]);

  const update = useCallback((fn) => {
    const next = cloneDoc(docRef.current);
    fn(next);
    set(next);
  }, [set]);

  const mark = useCallback(() => {
    past.current.push(docRef.current);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
  }, []);

  const commit = useCallback((fn) => { mark(); update(fn); }, [mark, update]);
  const replace = useCallback((doc) => { mark(); set(doc); }, [mark, set]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    future.current.push(docRef.current);
    set(past.current.pop());
  }, [set]);
  const redo = useCallback(() => {
    if (!future.current.length) return;
    past.current.push(docRef.current);
    set(future.current.pop());
  }, [set]);

  const reset = useCallback((doc) => { past.current = []; future.current = []; set(doc ?? newPcb()); }, [set]);

  return {
    doc: docRef.current, getDoc,
    update, mark, commit, replace, reset, undo, redo,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0,
  };
}
