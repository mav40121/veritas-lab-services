import { useSEO } from "@/hooks/useSEO";
import { FAQ_CATEGORIES } from "@/lib/faqContent";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";


export default function FAQPage() {
    useSEO({ title: "FAQ | VeritaAssure™ Lab Compliance Software", description: "Frequently asked questions about VeritaAssure™, CLIA compliance software, method verification, and laboratory inspection readiness tools." });
return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/8 via-transparent to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium">
            FAQ
          </Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Frequently Asked Questions
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            Everything you need to know about VeritaAssure&#8482; and clinical laboratory compliance.
          </p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="space-y-8">
          {FAQ_CATEGORIES.map(cat => (
            <div key={cat.category}>
              <h3 className="text-xs font-semibold text-primary uppercase tracking-widest mb-1 pb-2 border-b border-primary/20 scroll-mt-20">
                {cat.category}
              </h3>
              <Accordion type="multiple" className="w-full">
                {cat.items.map((item, i) => (
                  <AccordionItem key={item.q} value={`${cat.category}-${i}`}>
                    <AccordionTrigger className="text-sm font-medium text-foreground hover:text-primary transition-colors leading-snug text-left">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent>
                      <p className="text-sm text-muted-foreground leading-relaxed pr-8">{item.a}</p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
