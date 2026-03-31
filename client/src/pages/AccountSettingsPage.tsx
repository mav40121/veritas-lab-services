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

interface AccountSettings {
  clia_number: string;
  clia_lab_name: string;
}

export default function AccountSettingsPage() {
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const [cliaNumber, setCliaNumber] = useState("");
  const [labName, setLabName] = useState("");

  const { data: settings, isLoading } = useQuery<AccountSettings>({
    queryKey: ["/api/account/settings"],
    enabled: isLoggedIn,
  });

  useEffect(() => {
    if (settings) {
      setCliaNumber(settings.clia_number || "");
      setLabName(settings.clia_lab_name || "");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/account/settings", {
      clia_number: cliaNumber,
      clia_lab_name: labName,
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
    </div>
  );
}
