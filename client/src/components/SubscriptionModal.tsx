import { useState, useEffect, useCallback } from "react";
import { Lock } from "lucide-react";

// Global event bus for subscription errors
const SUBSCRIPTION_ERROR_EVENT = 'subscription-error';

export function triggerSubscriptionError(code: string, message: string) {
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_ERROR_EVENT, { detail: { code, message } }));
}

export function SubscriptionModal() {
  const [open, setOpen] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ code: string; message: string } | null>(null);

  const handleError = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail;
    setErrorInfo(detail);
    setOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener(SUBSCRIPTION_ERROR_EVENT, handleError);
    return () => window.removeEventListener(SUBSCRIPTION_ERROR_EVENT, handleError);
  }, [handleError]);

  if (!open || !errorInfo) return null;

  const isLocked = errorInfo.code === 'DATA_RETENTION_EXPIRED';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2 rounded-full ${isLocked ? 'bg-red-100 dark:bg-red-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
            <Lock size={20} className={isLocked ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'} />
          </div>
          <h3 className="font-bold text-lg">Subscription Required</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          {isLocked
            ? "Your data retention period has ended. Please resubscribe to regain access to your account."
            : "Your subscription has expired. Your existing data is preserved and viewable. Resubscribe to continue adding new records."
          }
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setOpen(false)}
            className="flex-1 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Close
          </button>
          <a
            href="/veritacheck"
            onClick={() => setOpen(false)}
            className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-center font-medium"
          >
            View Plans
          </a>
        </div>
      </div>
    </div>
  );
}
