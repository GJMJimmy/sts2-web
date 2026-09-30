// C#-faithful Task: awaiting a completed task continues synchronously; `async` methods are generators driven here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ext, iter } from './core';

const PENDING = 0, OK = 1, FAULT = 2, CANCEL = 3;

export class Task<T = any> {
  status = PENDING;
  result: any = undefined;
  error: any = undefined;
  $observed = false;
  private cbs: (() => void)[] | null = [];

  get IsCompleted() { return this.status !== PENDING; }
  get IsCompletedSuccessfully() { return this.status === OK; }
  get IsFaulted() { return this.status === FAULT; }
  get IsCanceled() { return this.status === CANCEL; }
  /** TaskStatus: WaitingForActivation=1, RanToCompletion=5, Canceled=6, Faulted=7 */
  get Status() { return [1, 5, 7, 6][this.status]; }
  get Result(): T {
    this.$observed = true;
    if (this.status === OK) return this.result;
    if (this.status === FAULT) throw this.error;
    if (this.status === CANCEL) throw new (ext('System.Threading.Tasks.TaskCanceledException'))('A task was canceled.');
    throw new Error('[rt] Task.Result read before completion (would deadlock in C#)');
  }
  get Exception() {
    this.$observed = true;
    return this.status === FAULT ? new (ext('System.AggregateException'))(this.error) : null;
  }

  $done(status: number, v?: any): boolean {
    if (this.status !== PENDING) return false;
    this.status = status;
    if (status === OK) this.result = v;
    else this.error = v;
    const cbs = this.cbs!;
    this.cbs = null;
    for (const cb of cbs) cb();
    if (status === FAULT && !this.$observed) setTimeout(() => { if (!this.$observed) console.error('[rt] unobserved task exception:', this.error); }, 0);
    return true;
  }
  $on(cb: () => void) {
    this.$observed = true;
    if (this.status !== PENDING) cb();
    else this.cbs!.push(cb);
  }
  then<R1 = T, R2 = never>(res?: ((v: T) => R1 | PromiseLike<R1>) | null, rej?: ((e: any) => R2 | PromiseLike<R2>) | null): Promise<R1 | R2> {
    return new Promise<T>((ok, fail) => this.$on(() => (this.status === OK ? ok(this.result) : fail(this.error ?? new (ext('System.Threading.Tasks.TaskCanceledException'))('A task was canceled.'))))).then(res, rej);
  }
  ContinueWith(fn: (t: Task<T>) => any): Task {
    const t = new Task();
    this.$on(() => {
      try {
        const r = fn(this);
        if (r instanceof Task) r.$on(() => t.$done(r.status, r.status === OK ? r.result : r.error));
        else t.$done(OK, r);
      } catch (e) {
        t.$done(FAULT, e);
      }
    });
    return t;
  }
  ConfigureAwait() { return this; }
  GetAwaiter() {
    return { IsCompleted: this.IsCompleted, GetResult: () => this.Result, OnCompleted: (cb: () => void) => this.$on(cb) };
  }
  Wait() {
    if (this.status === PENDING) throw new Error('[rt] Task.Wait on pending task');
    return this.Result;
  }
  Dispose() {}

  static get CompletedTask(): Task<void> { return completed; }
  static FromResult<T>(v: T): Task<T> { const t = new Task<T>(); t.$done(OK, v); return t; }
  static FromException(e: any): Task { const t = new Task(); t.$done(FAULT, e); return t; }
  static FromCanceled(): Task { const t = new Task(); t.$done(CANCEL); return t; }
  static WhenAll(tasks: any): Task<any[]> {
    const list = Array.from(iter(tasks)).map(toTask);
    const t = new Task<any[]>();
    let n = list.length;
    if (n === 0) { t.$done(OK, []); return t; }
    const res = new Array(n);
    let err: any = undefined, canceled = false;
    list.forEach((x, i) => x.$on(() => {
      if (x.status === FAULT && err === undefined) err = x.error;
      else if (x.status === CANCEL) canceled = true;
      else res[i] = x.result;
      if (--n === 0) err !== undefined ? t.$done(FAULT, err) : canceled ? t.$done(CANCEL) : t.$done(OK, res);
    }));
    return t;
  }
  static WhenAny(tasks: any): Task<Task> {
    const list = Array.from(iter(tasks)).map(toTask);
    const t = new Task<Task>();
    for (const x of list) x.$on(() => t.$done(OK, x));
    return t;
  }
  static Delay(ms: any, token?: any): Task {
    const t = new Task();
    const d = typeof ms === 'number' ? ms : ms?.TotalMilliseconds ?? 0;
    const h = setTimeout(() => t.$done(OK), d);
    token?.Register?.(() => { clearTimeout(h); t.$done(CANCEL); });
    return t;
  }
  static Yield(): Task {
    const t = new Task();
    setTimeout(() => t.$done(OK), 0);
    return t;
  }
  static Run(fn: () => any): Task {
    const t = new Task();
    queueMicrotask(() => {
      try {
        const r = fn();
        const rt = r instanceof Task ? r : r && typeof r.then === 'function' ? toTask(r) : null;
        if (rt) rt.$on(() => t.$done(rt.status, rt.status === OK ? rt.result : rt.error));
        else t.$done(OK, r);
      } catch (e) {
        t.$done(FAULT, e);
      }
    });
    return t;
  }
}
const completed = new Task<void>();
completed.$done(OK);

export function toTask(x: any): Task {
  if (x instanceof Task) return x;
  const t = new Task();
  if (x && typeof x.then === 'function') x.then((v: any) => t.$done(OK, v), (e: any) => t.$done(FAULT, e));
  else t.$done(OK, x);
  return t;
}

/** Drives a generator-compiled C# async method. */
export function async<T = any>(genFn: (this: any) => Generator<any, T, any>, self: any): Task<T> {
  const task = new Task<T>();
  let gen: Generator<any, T, any>;
  try {
    gen = genFn.call(self);
  } catch (e) {
    task.$done(FAULT, e);
    return task;
  }
  step(gen, task, undefined, false);
  return task;
}
function step(gen: Generator<any, any, any>, task: Task, val: any, isErr: boolean) {
  for (;;) {
    let r: IteratorResult<any, any>;
    try {
      r = isErr ? gen.throw(val) : gen.next(val);
    } catch (e) {
      task.$done(FAULT, e);
      return;
    }
    if (r.done) {
      task.$done(OK, r.value);
      return;
    }
    const aw = r.value;
    if (aw instanceof Task) {
      aw.$observed = true;
      if (aw.status !== PENDING) {
        isErr = aw.status !== OK;
        val = aw.status === OK ? aw.result : aw.status === FAULT ? aw.error : new (ext('System.Threading.Tasks.TaskCanceledException'))('A task was canceled.');
        continue;
      }
      aw.$on(() => step(gen, task, aw.status === OK ? aw.result : aw.status === FAULT ? aw.error : new (ext('System.Threading.Tasks.TaskCanceledException'))('A task was canceled.'), aw.status !== OK));
      return;
    }
    if (aw != null && typeof aw.then === 'function') {
      aw.then((v: any) => step(gen, task, v, false), (e: any) => step(gen, task, e, true));
      return;
    }
    val = aw;
    isErr = false;
  }
}

/** Re-iterable sequence produced by a C# iterator method. */
export class Seq<T = any> implements Iterable<T> {
  constructor(private fn: (this: any) => Iterator<T>, private self: any) {}
  [Symbol.iterator]() {
    return this.fn.call(this.self);
  }
}
export function seq(fn: (this: any) => Iterator<any>, self: any) {
  return new Seq(fn, self);
}

export class TaskCompletionSource<T = any> {
  Task = new Task<T>();
  SetResult(v?: T) { if (!this.Task.$done(OK, v)) throw new (ext('System.InvalidOperationException'))('TaskCompletionSource already completed'); }
  TrySetResult(v?: T) { return this.Task.$done(OK, v); }
  SetException(e: any) { if (!this.Task.$done(FAULT, e)) throw new (ext('System.InvalidOperationException'))('TaskCompletionSource already completed'); }
  TrySetException(e: any) { return this.Task.$done(FAULT, e); }
  SetCanceled() { this.Task.$done(CANCEL); }
  TrySetCanceled() { return this.Task.$done(CANCEL); }
}

export class CancellationToken {
  constructor(public src: CancellationTokenSource | null = null) {}
  static get None() { return new CancellationToken(null); }
  get IsCancellationRequested() { return this.src?.IsCancellationRequested ?? false; }
  get CanBeCanceled() { return this.src != null; }
  /** Runs `cb` right away when already cancelled (like .NET); Dispose unregisters. */
  Register(cb: () => void) {
    const src = this.src;
    if (!src) return { Dispose() {} };
    if (src.IsCancellationRequested) { cb(); return { Dispose() {} }; }
    src.$cbs.push(cb);
    return { Dispose() { const i = src.$cbs.indexOf(cb); if (i >= 0) src.$cbs.splice(i, 1); } };
  }
  ThrowIfCancellationRequested() {
    if (this.IsCancellationRequested) throw new (ext('System.OperationCanceledException'))('The operation was canceled.');
  }
  static $default() { return new CancellationToken(null); }
}
export class CancellationTokenSource {
  IsCancellationRequested = false;
  $cbs: (() => void)[] = [];
  get Token() { return new CancellationToken(this); }
  Cancel() {
    if (this.IsCancellationRequested) return;
    this.IsCancellationRequested = true;
    for (const cb of this.$cbs.splice(0)) cb();
  }
  CancelAfter(ms: number) { setTimeout(() => this.Cancel(), ms); }
  Dispose() {}
}
