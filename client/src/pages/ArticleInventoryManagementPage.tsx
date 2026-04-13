import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, User, AlertTriangle, Package } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";

function Callout({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warning" | "tip" }) {
  const styles = {
    info: "border-primary/20 bg-primary/5 text-foreground",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
    tip: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  };
  const icons = {
    info: <Package size={15} className="text-primary shrink-0 mt-0.5" />,
    warning: <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />,
    tip: <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />,
  };
  return (
    <div className={`rounded-lg border p-4 flex gap-3 text-sm leading-relaxed my-6 ${styles[type]}`}>
      {icons[type]}
      <div>{children}</div>
    </div>
  );
}

function FormulaBox({ title, formula, example }: { title: string; formula: string; example?: string }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 my-6">
      <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">{title}</div>
      <div className="font-mono text-sm font-semibold text-foreground bg-background rounded px-3 py-2 border border-border mb-3">{formula}</div>
      {example && <div className="text-xs text-muted-foreground leading-relaxed">{example}</div>}
    </div>
  );
}

export default function ArticleInventoryManagementPage() {
  useSEO({
    title: "Laboratory Inventory Management: A Practical Guide for Lab Directors | Veritas Lab Services",
    description: "How to apply reorder point discipline to clinical lab inventory. Covers burn rate, lead time, safety stock, standing orders, and the formulas that prevent stockouts without overspending.",
  });

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Lab Operations</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Lab Operations</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Laboratory Inventory Management: Stop Guessing, Start Using the Math
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            Most labs manage inventory by feel. They order when something looks low, stock extra because they are nervous, and scramble when a standing order misses a delivery. There is a better way - and the formulas are not complicated.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, MS, MBA, MLS(ASCP), CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 10 min read</span>
            <span>April 2026</span>
          </div>
        </div>
      </section>

      {/* Article body */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {/* Key Takeaways */}
        <Card className="border-primary/20 bg-primary/5 mb-10">
          <CardContent className="p-5">
            <div className="font-semibold text-sm text-primary mb-3">Key Takeaways</div>
            <ul className="space-y-2">
              {[
                "The reorder point formula eliminates stockouts - it tells you exactly when to order, not when you feel like ordering",
                "Burn rate is not static - it must be reviewed monthly or your reorder points become meaningless",
                "Standing orders are a tool, not a strategy - they need quarterly review or they silently drift out of alignment",
                "Safety stock is calculated, not guessed - 3 to 5 days covers most situations",
                "Overstocking is not safe - it ties up budget and creates expiration risk",
                "TJC and CLIA surveyors expect documented inventory processes - gut feel is not a documented process",
              ].map(t => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Section 1 */}
        <h2 className="font-serif text-2xl font-bold mt-10 mb-4">Why This Is a Quality Issue, Not Just a Logistics Issue</h2>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          A stockout of troponin reagent delays a chest pain workup. A stockout of blood culture bottles means a sepsis patient waits. These are not hypothetical scenarios - they happen in labs that manage inventory by feel instead of by system.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Inventory management sits at the intersection of patient care, budget discipline, and regulatory compliance. TJC and CLIA both expect labs to have documented processes for supply management. A surveyor who asks "how do you ensure you don't run out of critical reagents?" should get a specific, system-based answer - not "we check when things look low."
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          The good news is that the system is not complicated. It is built on a few core concepts and two formulas.
        </p>

        {/* Section 2 */}
        <h2 className="font-serif text-2xl font-bold mt-10 mb-4">The Core Concepts</h2>

        <h3 className="text-lg font-semibold mt-6 mb-2">Order Units vs. Usage Units</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          This distinction causes more confusion than anything else in lab inventory. You order gloves by the box. You use them individually. The order unit is a box. The usage unit is one glove. A box contains 100 gloves.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          When someone says "we have 3 boxes of gloves left," that means very different things depending on your burn rate. Always track inventory in usage units for the math, then convert to order units when placing the order.
        </p>

        <h3 className="text-lg font-semibold mt-6 mb-2">Burn Rate</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Burn rate is how fast you consume an item, expressed in usage units per day. If your lab runs 10 troponin tests per day and each test uses one cartridge, your burn rate is 10 cartridges per day.
        </p>
        <Callout type="warning">
          Burn rate is not static. Patient volume changes, test menus change, and seasonal patterns affect consumption. A burn rate set in January may be wrong by April. Review burn rates monthly - not quarterly, not annually. Monthly.
        </Callout>

        <h3 className="text-lg font-semibold mt-6 mb-2">Lead Time</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Lead time is the number of days between placing an order and receiving it. If your vendor delivers 5 days after you order, your lead time is 5 days.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Track your actual lead times, not your assumed lead times. Vendors are not always consistent. If a vendor promises 3 days but routinely delivers in 5, use 5 in your calculations - or find a better vendor.
        </p>

        <h3 className="text-lg font-semibold mt-6 mb-2">Safety Stock</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Safety stock is a buffer of extra inventory kept on hand to absorb unexpected demand spikes or delivery delays. It is not a guess - it is a calculated cushion.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          A common starting point: 3 days of safety stock for routine items, 5 to 7 days for critical reagents or items with unreliable vendors. The safety stock days get added to your lead time in the reorder point formula.
        </p>

        <h3 className="text-lg font-semibold mt-6 mb-2">Standing Orders</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          A standing order is an automatic recurring order placed with a vendor on a set schedule. They are useful for high-volume, predictable-consumption items. They are a liability if they are not reviewed.
        </p>
        <Callout type="warning">
          Standing orders must be reviewed quarterly. If your burn rate increases and your standing order does not, you will have a stockout despite being on a standing order. If your burn rate decreases, you will overstock and risk expiration waste. Neither is acceptable.
        </Callout>

        {/* Section 3 - Reorder Point */}
        <h2 className="font-serif text-2xl font-bold mt-10 mb-4">The Reorder Point: When to Order</h2>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          The reorder point is the stock level at which you must place an order. Not when you think about ordering. Not when things look low. When your on-hand quantity hits this number, the order goes out that day.
        </p>

        <FormulaBox
          title="Reorder Point Formula"
          formula="Reorder Point = Burn Rate x (Lead Time Days + Safety Stock Days)"
          example="Example: Burn rate 10 units/day, lead time 5 days, safety stock 3 days. Reorder Point = 10 x (5 + 3) = 80 units. When you have 80 units on hand, order immediately."
        />

        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          The logic: if you order when you have 80 units and it takes 5 days to receive the order, you will consume 50 units during that wait (10/day x 5 days). You will have 30 units left when the order arrives. That 30-unit cushion is your safety stock - 3 days worth at your current burn rate.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          If you wait until you have 50 units before ordering, you will run out before the delivery arrives. That is a stockout. That is a patient care issue.
        </p>

        <Callout type="tip">
          Common mistake: setting the reorder point based on how much space is left on the shelf. The shelf has nothing to do with it. The math is what matters.
        </Callout>

        {/* Section 4 - How Much to Order */}
        <h2 className="font-serif text-2xl font-bold mt-10 mb-4">How Much to Order</h2>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Once you know when to order, you need to know how much. The order-to quantity is the maximum stock level you want on hand after the delivery arrives.
        </p>

        <FormulaBox
          title="Order-to Quantity"
          formula="Order-to Quantity (units) = Burn Rate x Desired Days of Stock"
          example="Example: Burn rate 10 units/day, desired stock 30 days. Order-to Quantity = 10 x 30 = 300 units."
        />

        <FormulaBox
          title="Order Quantity"
          formula="Order Quantity = Order-to Quantity - Current On Hand (rounded UP to full order units)"
          example="Example: Order-to quantity 300 units, current on hand 80 units, box contains 100 units. Order quantity = 300 - 80 = 220 units. Divide by 100 = 2.2 boxes. Round UP to 3 boxes (300 units). Never round down - you will be short."
        />

        <Callout type="tip">
          Always round up to the next full order unit. Ordering 2.2 boxes means ordering 3 boxes. You cannot order a fraction of a box, and rounding down leaves you short.
        </Callout>

        {/* Section 5 - Building the System */}
        <h2 className="font-serif text-2xl font-bold mt-10 mb-4">Building the System: What Every Lab Needs</h2>

        <h3 className="text-lg font-semibold mt-6 mb-2">An Inventory List</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Every item the lab uses regularly should be on a master inventory list. At minimum, each entry needs: item name, vendor, department, order unit, units per order unit, burn rate (units/day), lead time (days), standing order status, safety stock days, reorder point (calculated), order-to quantity (calculated), and current on-hand count.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          The list is only as useful as it is current. Assign one person ownership of maintaining it. Review it monthly when you update burn rates.
        </p>

        <h3 className="text-lg font-semibold mt-6 mb-2">Physical Counts</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          The system only works if current on-hand quantities are accurate. Conduct a full physical count quarterly at minimum. For the 10 to 20 highest-burn-rate items, cycle-count weekly - these are the items most likely to surprise you.
        </p>

        <h3 className="text-lg font-semibold mt-6 mb-2">Expiration Management</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          First-in, first-out (FIFO) rotation is non-negotiable. New stock goes to the back. Oldest stock gets used first. Any item within 30 days of expiration that cannot be consumed before expiry should be flagged immediately and reported through your quality management system.
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Expiration waste is almost always a symptom of overstocking. If items are expiring regularly, your order-to quantity is too high or your burn rate estimate is too optimistic.
        </p>

        <h3 className="text-lg font-semibold mt-6 mb-2">Survey Readiness</h3>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          When a TJC or CLIA surveyor asks how you manage reagent inventory, the answer should be specific: "We maintain a master inventory list with documented reorder points calculated from burn rates and lead times. We conduct physical counts on a defined schedule and review burn rates monthly."
        </p>
        <p className="text-base leading-relaxed text-muted-foreground mb-4">
          Have the list available. Have the process documented. "We check when things look low" is not a process.
        </p>

        {/* Quick Reference */}
        <h2 className="font-serif text-2xl font-bold mt-10 mb-4">Quick Reference</h2>
        <div className="overflow-x-auto rounded-lg border border-border mb-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-white">
                <th className="px-4 py-3 text-left font-semibold">Formula</th>
                <th className="px-4 py-3 text-left font-semibold">Calculation</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Reorder Point", "Burn Rate x (Lead Time Days + Safety Stock Days)"],
                ["Order-to Quantity (units)", "Burn Rate x Desired Days of Stock"],
                ["Order Quantity (units)", "Order-to Quantity - Current On Hand"],
                ["Order Quantity (order units)", "Order Quantity / Units per Order Unit, rounded UP"],
              ].map(([formula, calc], i) => (
                <tr key={formula} className={i % 2 === 0 ? "bg-white dark:bg-background" : "bg-[#EBF3F8] dark:bg-primary/5"}>
                  <td className="px-4 py-3 font-medium">{formula}</td>
                  <td className="px-4 py-3 font-mono text-xs">{calc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Glossary */}
        <h2 className="font-serif text-2xl font-bold mt-10 mb-4">Glossary</h2>
        <div className="space-y-3 mb-10">
          {[
            ["Burn Rate", "How fast an item is consumed, expressed in usage units per day."],
            ["Lead Time", "Number of days between placing an order and receiving delivery."],
            ["Safety Stock", "Extra inventory buffer to absorb delivery delays or demand spikes."],
            ["Reorder Point", "The on-hand quantity at which an order must be placed immediately."],
            ["Order-to Quantity", "The maximum desired stock level after a delivery arrives."],
            ["Order Unit", "The unit in which an item is purchased (box, case, kit, etc.)."],
            ["Usage Unit", "The individual unit consumed (single glove, single cartridge, etc.)."],
            ["Standing Order", "A recurring automatic order placed with a vendor on a set schedule."],
            ["FIFO", "First In, First Out - oldest stock is used before newer stock."],
            ["Stockout", "Running out of an item before a replacement order is received."],
            ["Cycle Count", "A partial inventory count of a subset of items on a rotating schedule."],
          ].map(([term, def]) => (
            <div key={term} className="flex gap-3 text-sm">
              <span className="font-semibold text-foreground min-w-40 shrink-0">{term}</span>
              <span className="text-muted-foreground">{def}</span>
            </div>
          ))}
        </div>

        {/* Closing */}
        <div className="border-t border-border pt-8 mb-10">
          <p className="text-base leading-relaxed text-muted-foreground">
            Inventory management is a discipline, not a task. Labs that do it well rarely think about it - the system handles it. Labs that do it poorly spend significant time and energy reacting to stockouts, rush orders, and expired reagents. The formulas in this article give you the foundation. Apply them consistently, review your burn rates monthly, and keep your inventory list current.
          </p>
        </div>

        {/* Newsletter */}
        <NewsletterSignup />

        {/* Related */}
        <div className="mt-12 pt-8 border-t border-border">
          <div className="text-sm font-semibold text-foreground mb-4">Related Resources</div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <ChevronRight size={14} className="text-primary" />
              <Link href="/resources/tjc-laboratory-inspection-checklist-preparation" className="text-primary hover:underline">TJC Laboratory Inspection Checklist and Preparation</Link>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ChevronRight size={14} className="text-primary" />
              <Link href="/resources/clia-calibration-verification-method-comparison" className="text-primary hover:underline">CLIA Calibration Verification and Method Comparison Guide</Link>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ChevronRight size={14} className="text-primary" />
              <Link href="/veritaassure" className="text-primary hover:underline">VeritaAssure™ - Laboratory Compliance Platform</Link>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-10 pt-6 border-t border-border">
          Veritas Lab Services, LLC offers VeritaAssure™, a clinical laboratory compliance and quality management platform. A laboratory inventory management module (VeritaStock™) is planned for a future release.
        </p>

      </div>
    </div>
  );
}
