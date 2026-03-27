import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/login", loginForm);
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Login failed", variant: "destructive" }); return; }
      login(data.token, data.user);
      navigate("/dashboard");
    } catch { toast({ title: "Login failed", variant: "destructive" }); }
    finally { setLoading(false); }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/register", registerForm);
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Registration failed", variant: "destructive" }); return; }
      login(data.token, data.user);
      navigate("/dashboard");
    } catch { toast({ title: "Registration failed", variant: "destructive" }); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <FlaskConical size={22} className="text-primary" />
          </div>
          <h1 className="font-serif text-2xl font-bold">VeritaCheck Account</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to save and access your studies</p>
        </div>
        <Card>
          <CardContent className="pt-5">
            <Tabs defaultValue="login">
              <TabsList className="grid grid-cols-2 w-full mb-5">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="register">Create Account</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={loginForm.email} onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))} placeholder="you@lab.com" required /></div>
                  <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} required /></div>
                  <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">{loading ? "Signing in…" : "Sign In"}</Button>
                  <p className="text-center text-xs text-muted-foreground"><a href="/#/reset-password" className="text-primary hover:underline">Forgot your password?</a></p>
                </form>
              </TabsContent>
              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-1.5"><Label>Full Name</Label><Input value={registerForm.name} onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" required /></div>
                  <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={registerForm.email} onChange={e => setRegisterForm(f => ({ ...f, email: e.target.value }))} placeholder="you@lab.com" required /></div>
                  <div className="space-y-1.5"><Label>Password</Label><Input type="password" value={registerForm.password} onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 6 characters" required /></div>
                  <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">{loading ? "Creating account…" : "Create Account"}</Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <p className="text-xs text-center text-muted-foreground mt-4">You can also run a study as a guest without an account.</p>
      </div>
    </div>
  );
}
