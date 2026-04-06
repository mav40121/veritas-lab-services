import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/components/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, AlertTriangle } from "lucide-react";

interface InviteInfo {
  valid: boolean;
  labName?: string;
  inviterName?: string;
  seatEmail?: string;
  reason?: "expired" | "not_found" | "already_accepted";
}

export default function JoinPage() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [hipaaAcknowledged, setHipaaAcknowledged] = useState(false);
  const [hipaaError, setHipaaError] = useState("");

  // Extract token from URL
  const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";

  useEffect(() => {
    if (!token) {
      setInvite({ valid: false, reason: "not_found" });
      setChecking(false);
      return;
    }
    fetch(`/api/seats/invite/${token}`)
      .then(r => r.json())
      .then((data: InviteInfo) => {
        setInvite(data);
        if (data.valid && data.seatEmail) {
          setForm(f => ({ ...f, email: data.seatEmail! }));
        }
      })
      .catch(() => setInvite({ valid: false, reason: "not_found" }))
      .finally(() => setChecking(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hipaaAcknowledged) {
      setHipaaError("You must agree to the data use policy to create an account.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (form.password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setHipaaError("");
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/register", {
        name: form.name,
        email: form.email,
        password: form.password,
        hipaa_acknowledged: true,
        inviteToken: token,
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Registration failed", variant: "destructive" });
        return;
      }
      if (data.session_token) {
        localStorage.setItem("veritas_session_token", data.session_token);
      }
      login(data.token, data.user);
      navigate("/dashboard");
    } catch {
      toast({ title: "Registration failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-muted-foreground">Verifying invitation...</p>
      </div>
    );
  }

  if (!invite || !invite.valid) {
    const message =
      invite?.reason === "expired"
        ? "This invitation has expired."
        : invite?.reason === "already_accepted"
        ? "This invitation has already been accepted."
        : "This invitation link is not valid.";
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
            <h2 className="text-xl font-semibold">{message}</h2>
            <p className="text-sm text-muted-foreground">
              Contact your lab administrator for a new invitation.
            </p>
            <Button variant="outline" onClick={() => navigate("/login")}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 space-y-6">
          <div className="text-center space-y-2">
            <FlaskConical className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-xl font-semibold">
              You've been invited to join {invite.labName}
            </h2>
            <p className="text-sm text-muted-foreground">
              Create your account to get started. Your lab is already set up - you just need to sign in.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Your name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Min 6 characters"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password</Label>
              <Input
                type="password"
                value={form.confirmPassword}
                onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                placeholder="Confirm password"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hipaaAcknowledged}
                  onChange={e => { setHipaaAcknowledged(e.target.checked); if (e.target.checked) setHipaaError(""); }}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0"
                />
                <span className="text-sm text-foreground leading-relaxed">
                  I understand that VeritaAssure&#8482; is not a HIPAA-covered platform and is not designed to store, process, or transmit protected health information (PHI). I agree to use only de-identified data, sample IDs, QC lot numbers, and non-patient-identifiable information when entering data into any VeritaAssure&#8482; module.
                </span>
              </label>
              {hipaaError && <p className="text-sm text-red-600">{hipaaError}</p>}
            </div>

            <Button
              type="submit"
              disabled={loading || !hipaaAcknowledged}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {loading ? "Creating account..." : "Create Account & Join Lab"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
