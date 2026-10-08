import { Link } from "wouter";
import { ClipboardCheck, FlaskConical, PackageCheck, Wrench, PenLine } from "lucide-react";
import { useLabRoute } from "@/hooks/useLabRoute";

// #84 (2026-10-08): the dashboard's first card for a Staff login. Staff see the
// same module screens as editors and do the recording work there; this card is
// their front door to it, in place of the owner's setup checklist and how-to.
export function StaffMyWorkCard({ className = "" }: { className?: string }) {
  const labRoute = useLabRoute();
  const items = [
    { href: labRoute("/veritaqc-app"), icon: FlaskConical, title: "Record QC", detail: "Enter control results, add notes and file corrective actions." },
    { href: labRoute("/veritatrack-app"), icon: ClipboardCheck, title: "Sign off tasks", detail: "Daily, weekly and monthly tasks assigned to the lab." },
    { href: labRoute("/veritastock"), icon: PackageCheck, title: "Count and receive inventory", detail: "Scan to count, receive orders and write off expired stock." },
    { href: labRoute("/equipment-app"), icon: Wrench, title: "Log maintenance", detail: "Record maintenance done on an instrument." },
    { href: "/staff-access", icon: PenLine, title: "My sign-offs", detail: "Policies and competency items waiting for your signature." },
  ];
  return (
    <div className={`rounded-lg border bg-card ${className}`} data-testid="staff-my-work">
      <div className="px-4 pt-3 pb-1 text-sm font-semibold">My work</div>
      <ul className="grid gap-1 p-2 sm:grid-cols-2">
        {items.map(({ href, icon: Icon, title, detail }) => (
          <li key={title}>
            <Link href={href} className="flex items-start gap-3 rounded-md px-3 py-2 hover:bg-muted" data-testid={`staff-my-work-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
              <Icon size={18} className="mt-0.5 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{title}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
