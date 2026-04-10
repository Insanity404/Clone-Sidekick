import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastCtx {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, type === 'error' ? 4000 : 2500);
  }, []);

  const colors: Record<ToastType, string> = {
    info: 'bg-gray-800/90 text-gray-300',
    success: 'bg-green-900/90 text-green-300',
    error: 'bg-red-900/90 text-red-300',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center gap-2">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`px-4 py-2 rounded-lg text-sm font-medium shadow-lg backdrop-blur ${colors[t.type]}`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
