let _send: ((msg: Record<string, unknown>) => void) | null = null;

const pendingRequests = new Map<string, { resolve: (data: any) => void; reject: (err: Error) => void; timer: Timer }>();
let _reqCounter = 0;

export function setSendFn(fn: ((msg: Record<string, unknown>) => void) | null): void {
  _send = fn;
}

export function sendToDashboard(msg: Record<string, unknown>): void {
  _send?.(msg);
}

export function requestFromDashboard<T = unknown>(msg: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++_reqCounter}_${Date.now()}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request timed out: ${msg.type}`));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, reject, timer });
    _send?.({ ...msg, requestId });
  });
}

export function resolveRequest(requestId: string, data: unknown, error?: string): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRequests.delete(requestId);
  if (error) pending.reject(new Error(error));
  else pending.resolve(data);
}

export function rejectAllPendingRequests(reason: string): void {
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  pendingRequests.clear();
}
