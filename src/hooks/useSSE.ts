import { useEffect, useRef, useCallback } from 'react';

export function useSSE() {
  const controllerRef = useRef<AbortController | null>(null);
  const tokenCallbackRef = useRef<((content: string) => void) | null>(null);
  const errorCallbackRef = useRef<((error: { status: number; message: string }) => void) | null>(null);
  const completeCallbackRef = useRef<(() => void) | null>(null);

  const onToken = useCallback((handler: (content: string) => void) => {
    tokenCallbackRef.current = handler;
  }, []);

  const onError = useCallback((handler: (error: { status: number; message: string }) => void) => {
    errorCallbackRef.current = handler;
  }, []);

  const onComplete = useCallback((handler: () => void) => {
    completeCallbackRef.current = handler;
  }, []);

  useEffect(() => {
    const handleToken = (e: Event) => {
      const detail = (e as CustomEvent<{ content: string }>).detail;
      tokenCallbackRef.current?.(detail.content);
    };

    const handleError = (e: Event) => {
      const detail = (e as CustomEvent<{ status: number; message: string }>).detail;
      errorCallbackRef.current?.(detail);
    };

    const handleComplete = () => {
      completeCallbackRef.current?.();
    };

    window.addEventListener('sse-token', handleToken);
    window.addEventListener('sse-error', handleError);
    window.addEventListener('sse-complete', handleComplete);

    return () => {
      window.removeEventListener('sse-token', handleToken);
      window.removeEventListener('sse-error', handleError);
      window.removeEventListener('sse-complete', handleComplete);
    };
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return {
    onToken,
    onError,
    onComplete,
    abort,
    controllerRef,
  };
}
