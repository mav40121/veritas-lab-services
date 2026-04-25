import { useSEO } from "@/hooks/useSEO";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Clock, CheckCircle2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ContactPage() {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/contact", form),
    onSuccess: () => { setSent(true); setForm({ name: "", email: "", message: "" }); },
    onError: () => toast({ title: "Something went wrong. Please email us directly.", variant: "destructive" }),
  });

  useSEO({ title: "Contact | Veritas Lab Services", description: "Get in touch with Veritas Lab Services. Questions about VeritaAssure™, laboratory consulting, or scheduling a demo." });

  return (
    <div>
      <section className="border-b border-border bg-secondary/20">
        <div className="container-default py-14">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30">Contact</Badge>
          <h1 className="font-serif text-4xl font-bold mb-3">Tell Us About Your Needs</h1>
          <p className="text-muted-foreground text-lg max-w-xl">We work with clients to bring them the best solution for their laboratory needs.</p>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-default max-w-4xl">
          <div className="grid sm:grid-cols-2 gap-10">
            {/* Form */}
            <div>
              {sent ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                  <CheckCircle2 size={40} className="text-primary" />
                  <h3 className="font-semibold text-lg">Message sent!</h3>
                  <p className="text-sm text-muted-foreground">We'll respond promptly. For urgent matters, email info@veritaslabservices.com directly.</p>
                  <Button variant="outline" onClick={() => setSent(false)} className="mt-2">Send another message</Button>
                </div>
              ) : (
                <form onSubmit={e => { e.preventDefault(); mutation.mutate(); }} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="your@email.com" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="message">Message</Label>
                    <Textarea id="message" rows={5} value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} placeholder="Tell us about your laboratory and what you're looking for..." required />
                  </div>
                  <Button type="submit" disabled={mutation.isPending} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                    {mutation.isPending ? "Sending…" : "Send Message"}
                  </Button>
                </form>
              )}
            </div>

            {/* Info */}
            <div className="space-y-4">
              <Card><CardContent className="p-5 flex gap-3">
                <Mail size={18} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-sm">Email</div>
                  <a href="mailto:info@veritaslabservices.com" className="text-sm text-muted-foreground hover:text-primary transition-colors">info@veritaslabservices.com</a>
                </div>
              </CardContent></Card>
              <Card><CardContent className="p-5 flex gap-3">
                <Clock size={18} className="text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-sm">Response Time</div>
                  <p className="text-sm text-muted-foreground">We respond to emails promptly, typically within one business day.</p>
                </div>
              </CardContent></Card>
              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-sm font-medium text-primary mb-1">Not sure which service fits?</p>
                <p className="text-sm text-muted-foreground">Describe your laboratory and current challenges. We'll help identify the best solution for your situation. No commitment required.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
