import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Package, ScanLine, ArrowLeftRight, RefreshCw, CalendarClock, ShieldCheck,
  Smartphone, ClipboardCheck, Building2, ArrowDown, Microscope, Stethoscope,
  ChevronRight, ArrowRight,
} from "lucide-react";

// Placeholder product name. Swap "VeritaStock" if the standalone inventory
// product gets its own brand. Route is /hospital-inventory because
// /veritastock (the app) and /inventory (Staff Portal redirect) are taken.
const DEMO_MAILTO = "mailto:info@veritaslabservices.com?subject=Hospital%20inventory%20demo";

const features = [
  { icon: ArrowLeftRight, title: "Multi-location transfers", desc: "Move stock from your warehouse down to a stockroom, back up, or across sites. Every move is logged with a full chain of custody." },
  { icon: ScanLine, title: "Barcode scan to count", desc: "Scan a shelf on any phone. Counts update live, in the unit you stock in, with who and when on every entry." },
  { icon: RefreshCw, title: "Par-driven replenishment", desc: "When a stockroom dips below par, restock from your own warehouse first. Only order from the vendor when the warehouse runs dry." },
  { icon: CalendarClock, title: "Lot, expiration, and audit", desc: "Track lots and expiry, catch waste before it happens, and hand an inspector a clean, defensible record." },
];

const steps = [
  { n: "1", title: "Scan", desc: "Barcode your shelves and count once." },
  { n: "2", title: "Track", desc: "Burn rate and par level for every location." },
  { n: "3", title: "Replenish", desc: "Transfer or order, and never run out." },
];

export default function HospitalInventoryPage() {
  useSEO({
    title: "VeritaStock™ Hospital Inventory Management | Multi-Location Supply Tracking",
    description: "Multi-location supply inventory for hospitals and clinics. Barcode counting, warehouse-to-stockroom transfers, par-driven replenishment, lot and expiration tracking, and a surveyor-ready audit trail. No PHI.",
  });

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-24 text-center">
          <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 font-medium mb-5">For hospitals, clinics, and labs</Badge>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight mb-5 leading-tight text-foreground max-w-3xl mx-auto">
            Hospital inventory control, without the six-figure system
          </h1>
          <p className="text-lg text-muted-foreground mb-8 leading-relaxed max-w-2xl mx-auto">
            Track every supply across your warehouse and stockrooms, scan to count on any phone, and stop running out or expiring stock. Built for the facilities the big systems price out.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <a href={DEMO_MAILTO}>Book a demo <ChevronRight size={16} className="ml-1" /></a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
          <div className="flex gap-5 justify-center flex-wrap mt-7 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-primary" /> No PHI, ever</span>
            <span className="inline-flex items-center gap-1.5"><ClipboardCheck size={15} className="text-primary" /> Surveyor-ready audit trail</span>
            <span className="inline-flex items-center gap-1.5"><Smartphone size={15} className="text-primary" /> Works on any phone</span>
          </div>
        </div>
      </section>

      {/* The gap */}
      <section className="border-b border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <p className="text-center text-sm text-muted-foreground mb-6">The gap nobody fills</p>
          <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Enterprise systems</p><p className="font-semibold mt-1">Six figures and up</p><p className="text-sm text-muted-foreground mt-1">Out of reach for a small hospital.</p></CardContent></Card>
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Spreadsheets</p><p className="font-semibold mt-1">Free and blind</p><p className="text-sm text-muted-foreground mt-1">Stockouts, expired waste, no audit.</p></CardContent></Card>
            <Card className="border-2 border-primary"><CardContent className="p-5"><p className="text-sm text-primary font-medium">VeritaStock&trade;</p><p className="font-semibold mt-1">The middle</p><p className="text-sm text-muted-foreground mt-1">Enterprise discipline, software pricing.</p></CardContent></Card>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="font-serif text-3xl font-bold text-center mb-2 text-foreground">Everything you need, nothing you do not</h2>
          <p className="text-center text-muted-foreground mb-10">No EHR integration to buy, no cabinets to install.</p>
          <div className="grid sm:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {features.map((f) => (
              <Card key={f.title}>
                <CardContent className="p-6">
                  <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4"><f.icon size={22} /></div>
                  <p className="font-semibold mb-1.5">{f.title}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Multi-location */}
      <section className="border-b border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="font-serif text-3xl font-bold text-center mb-8 text-foreground">One warehouse, every stockroom, in sync</h2>
          <div className="max-w-2xl mx-auto">
            <div className="flex justify-center">
              <div className="bg-primary text-primary-foreground rounded-lg px-6 py-3 font-semibold inline-flex items-center gap-2"><Building2 size={18} /> Main warehouse</div>
            </div>
            <div className="flex justify-center text-muted-foreground my-2"><ArrowDown size={20} /></div>
            <div className="grid grid-cols-3 gap-3">
              <Card><CardContent className="p-4 text-center"><Microscope size={20} className="text-primary mx-auto" /><p className="text-sm font-medium mt-1.5">Lab</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><Stethoscope size={20} className="text-primary mx-auto" /><p className="text-sm font-medium mt-1.5">ED stockroom</p></CardContent></Card>
              <Card><CardContent className="p-4 text-center"><Package size={20} className="text-primary mx-auto" /><p className="text-sm font-medium mt-1.5">Respiratory</p></CardContent></Card>
            </div>
            <p className="text-center text-sm text-muted-foreground mt-5 flex items-center gap-1.5 justify-center"><ArrowLeftRight size={15} className="text-primary" /> Transfer down, up, or across, with a full chain of custody.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="font-serif text-3xl font-bold text-center mb-10 text-foreground">Up and running in days</h2>
          <div className="grid sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {steps.map((s) => (
              <div key={s.n} className="text-center">
                <div className="w-11 h-11 rounded-lg bg-primary/10 text-primary font-semibold flex items-center justify-center mx-auto mb-3 text-lg">{s.n}</div>
                <p className="font-semibold mb-1">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
          <div className="rounded-xl bg-[#F0FAFA] border border-primary/20 px-6 sm:px-8 py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="font-semibold text-foreground mb-1">Priced per location, not per six-figure contract</p>
              <p className="text-sm text-muted-foreground">Enterprise inventory at a fraction of what the big systems cost. It scales as you add stockrooms.</p>
            </div>
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold whitespace-nowrap"><a href={DEMO_MAILTO}>Get a quote</a></Button>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-[#04342C]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-white mb-3">Stop running out. Stop expiring. Stop guessing.</h2>
          <p className="text-[#9FE1CB] mb-8 max-w-xl mx-auto">See it on your own stockroom in a 20-minute demo.</p>
          <Button asChild size="lg" className="bg-white text-[#04342C] hover:bg-white/90 font-semibold"><a href={DEMO_MAILTO}>Book a demo <ArrowRight size={16} className="ml-1" /></a></Button>
          <p className="text-sm text-white/60 mt-8">From the team behind VeritaAssure&trade;. Built by lab and quality professionals. No patient data, ever.</p>
        </div>
      </section>
    </div>
  );
}
