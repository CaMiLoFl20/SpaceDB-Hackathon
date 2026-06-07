export type ToastItem = {
  id: number;
  title: string;
  detail: string;
  tone: 'success' | 'error' | 'alert';
};

export function ToastStack({ toasts }: { toasts: readonly ToastItem[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => (
        <div className={`toast toast--${toast.tone}`} key={toast.id}>
          <strong>{toast.title}</strong>
          <span>{toast.detail}</span>
        </div>
      ))}
    </div>
  );
}
