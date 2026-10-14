import { create } from 'zustand';

interface ToastState {
  message: string | null;
  show: (m: string) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), 2600);
  },
}));

export const toast = (m: string) => useToast.getState().show(m);

export function ToastHost() {
  const message = useToast((s) => s.message);
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <div className="animate-fade rounded-full bg-action px-5 py-3 text-sm font-medium text-on-action shadow-lg">{message}</div>
    </div>
  );
}
