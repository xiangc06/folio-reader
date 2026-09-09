// Worker libraries do not always settle their pending jobs when terminated.
export function abortable<T>(task: Promise<T>, signal: AbortSignal, timeoutMs = 180_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Import canceled', 'AbortError')); };
    timer = setTimeout(() => { cleanup(); reject(new Error('Text recognition took too long. Check your connection or try a smaller, clearer image.')); }, timeoutMs);
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) abort();
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
