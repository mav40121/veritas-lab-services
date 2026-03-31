import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "./AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { X, ArrowRight } from "lucide-react";

export function OnboardingBanner() {
  const { user, isLoggedIn } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!isLoggedIn || !user) return null;
  if ((user as any).onboardingSeen) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    apiRequest("POST", "/api/onboarding/seen").catch(() => {});
  };

  return (
    <div className="bg-primary text-primary-foreground px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          Welcome to VeritaAssure&#8482;. Complete your lab setup to get the most out of the platform.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild size="sm" variant="secondary" className="bg-white text-primary hover:bg-white/90 font-medium">
            <Link href="/getting-started">
              Get Started <ArrowRight size={13} className="ml-1" />
            </Link>
          </Button>
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-white/20 transition-colors"
            aria-label="Dismiss banner"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
