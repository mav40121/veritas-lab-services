import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";

type AccreditationBody = "CAP" | "TJC" | "COLA" | "AABB";
const ACCREDITATION_OPTIONS: { value: AccreditationBody; label: string; description: string }[] = [
  { value: "CAP",  label: "CAP",  description: "College of American Pathologists" },
  { value: "TJC",  label: "TJC",  description: "The Joint Commission" },
  { value: "COLA", label: "COLA", description: "Commission on Office Laboratory Accreditation" },
  { value: "AABB", label: "AABB", description: "AABB (blood banking / transfusion)" },
];

interface AccountSettings {
  clia_number: string;
  clia_lab_name: string;
  preferred_standards: AccreditationBody[];
}

export default function AccountSettingsPage() {
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const [cliaNumber, setCliaNumber] = useState("");
  const [labName, setLabName] = useState("");
  const [preferredStandards, setPreferredStandards] = useState<AccreditationBody[]>([]);

  const { data: settings, isLoading } = useQuery<AccountSettings>({
    queryKey: ["/api/account/settings"],
    enabled: isLoggedIn,
  });

  useEffect(() => {
    if (settings) {
      setCliaNumber(settings.clia_number || "");
      setLabName(settings.clia_lab_name || "");
      setPreferredStandards(settings.preferred_standards || []);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/account/settings", {
      clia_number: cliaNumber,
      clia_lab_name: labName,
      preferred_standards: preferredStandards,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/account/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      toast({ title: "Settings saved" });
    },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  if (!isLoggedIn) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold mb-4">Account Settings</h1>
        <p className="text-muted-foreground">Sign in to access your account settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold mb-6">Account Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lab Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clia_number">CLIA Number</Label>
            <Input
              id="clia_number"
              value={cliaNumber}
              onChange={(e) => setCliaNumber(e.target.value)}
              placeholder="e.g. 05D2187634"
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lab_name">Lab Name</Label>
            <Input
              id="lab_name"
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              placeholder="e.g. Riverside Regional Medical Center"
              disabled={isLoading}
            />
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Save size={14} className="mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Accreditation &amp; Standards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Select up to 2 accreditation bodies. Their standard references will appear on all VeritaCheck and VeritaScan reports. CLSI guidelines and CLIA/CFR citations are always included.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ACCREDITATION_OPTIONS.map((opt) => {
              const isSelected = preferredStandards.includes(opt.value);
              const isDisabled = !isSelected && preferredStandards.length >= 2;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isDisabled || isLoading}
                  onClick={() => {
                    if (isSelected) {
                      setPreferredStandards(preferredStandards.filter(s => s !== opt.value));
                    } else if (preferredStandards.length < 2) {
                      setPreferredStandards([...preferredStandards, opt.value]);
                    }
                  }}
                  className={[
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : isDisabled
                      ? "border-muted bg-muted/30 opacity-50 cursor-not-allowed"
                      : "border-border hover:border-primary/50 hover:bg-muted/30",
                  ].join(" ")}
                >
                  <div className={[
                    "mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center",
                    isSelected ? "border-primary bg-primary" : "border-muted-foreground",
                  ].join(" ")}>
                    {isSelected && (
                      <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-primary-foreground">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-muted-foreground">{opt.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {preferredStandards.length === 2 && (
            <p className="text-xs text-muted-foreground">Maximum of 2 selected. Deselect one to choose another.</p>
          )}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Save size={14} className="mr-1.5" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
