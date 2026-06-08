import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthContext";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sun, Moon, Menu, X, ChevronDown, FlaskConical, TestTube, User, LogOut, LayoutDashboard, Play, ListChecks, ShieldCheck, BarChart3 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { LabSwitcher, LabSwitcherMobile } from "@/components/LabSwitcher";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useMemberships } from "@/hooks/useMemberships";
import { useActiveLabId } from "@/hooks/useActiveLabId";

// Mobile menu IA \u2014 mirrors the desktop nav structure (top-level links +
// collapsible groups) instead of dumping every route as a flat 27-item
// list that overflows the viewport. Sections start collapsed; user
// expands the group they want. Marketing routes use bare hrefs.
const mobileTopLinks: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Consulting" },
  { href: "/pricing", label: "Plans" },
];
const mobileVeritaassureLinks: { href: string; label: string }[] = [
  { href: "/veritaassure", label: "All Modules Overview" },
  { href: "/veritacheck", label: "VeritaCheck\u2122" },
  { href: "/veritacheck/cumsum", label: "VeritaCheck\u2122 CUMSUM" },
  { href: "/veritascan", label: "VeritaScan\u2122" },
  { href: "/veritamap", label: "VeritaMap\u2122" },
  { href: "/veritacomp", label: "VeritaComp\u2122" },
  { href: "/veritastaff", label: "VeritaStaff\u2122" },
  { href: "/veritapt", label: "VeritaPT\u2122" },
  { href: "/veritalab", label: "VeritaLab\u2122" },
  { href: "/veritapolicy", label: "VeritaPolicy\u2122" },
  { href: "/veritaqc-app", label: "VeritaQC\u2122" },
  { href: "/veritatrack", label: "VeritaTrack\u2122" },
];
const mobileResourcesLinks: { href: string; label: string }[] = [
  { href: "/getting-started", label: "Getting Started" },
  { href: "/resources", label: "Articles" },
  { href: "/book", label: "Lab Management 101 Book" },
  { href: "/study-guide", label: "Study Guide" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/faq", label: "FAQ" },
];
const mobileOperationsLinks: { href: string; label: string }[] = [
  { href: "/operations", label: "Operations Overview" },
  { href: "/calculator", label: "VeritaBench\u2122" },
  { href: "/veritabench", label: "VeritaPace\u2122" },
  { href: "/veritabench/staffing", label: "VeritaShift\u2122" },
  { href: "/veritabench/pi", label: "VeritaQA\u2122" },
  { href: "/veritastock", label: "VeritaStock\u2122" },
  { href: "/veritaops-app", label: "VeritaOps\u2122" },
];
const mobileFooterLinks: { href: string; label: string }[] = [
  { href: "/team", label: "Our Team" },
  { href: "/contact", label: "Contact" },
];


export function NavBar() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout, isLoggedIn } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Mobile menu collapsible-group state. Resets every time the menu closes
  // so the next open starts with the same short IA.
  const [mobileExpanded, setMobileExpanded] = useState<Set<string>>(new Set());
  function toggleMobileGroup(key: string) {
    setMobileExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function closeMobile() {
    setMobileOpen(false);
    setMobileExpanded(new Set());
  }
  const labRoute = useLabRoute();
  const { data: memberships } = useMemberships();
  const activeLabId = useActiveLabId();
  const activeMembership =
    memberships?.find(m => m.labId === activeLabId) ??
    memberships?.find(m => m.isPrimaryLab) ??
    memberships?.[0];
  const showMembersLink = activeMembership && (activeMembership.role === "owner" || activeMembership.role === "admin");
  const membersHref = activeMembership ? `/labs/${activeMembership.labId}/members` : null;

  const isActive = (href: string) => location === href;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <svg viewBox="0 0 36 36" width="32" height="32" fill="none" aria-label="Veritas Lab Services">
            <rect width="36" height="36" rx="8" fill="hsl(182 65% 30%)" />
            <path d="M9 10h18M18 10v6l-6 10h12L18 16" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M13 24l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="leading-tight">
            <div className="font-serif font-bold text-sm tracking-tight text-foreground">Veritas Lab Services</div>
            <div className="text-xs text-muted-foreground leading-none">Clinical Laboratory Consulting</div>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-0.5">

          {/* Home */}
          <Link href="/" className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            isActive("/") ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
            Home
          </Link>

          {/* Consulting (route stays /services; only the displayed label changes) */}
          <Link href="/services" className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            isActive("/services") ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
            Consulting
          </Link>

          {/* Plans (route stays /pricing; only the displayed label changes) */}
          <Link href="/pricing" className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            isActive("/pricing") ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
            Plans
          </Link>

          {/* VeritaAssure — direct link to all-modules suite page */}
          <Link
            href="/veritaassure"
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              ["/veritaassure","/veritacheck","/veritacheck/cumsum","/veritascan","/veritamap","/veritatrack","/veritatrack-app","/veritacomp","/veritastaff","/veritapt","/veritalab","/veritapolicy","/veritaqc-app","/veritaresponse","/book"].some(p => location === p || location.startsWith(p + "/"))
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            <ShieldCheck size={13} className="text-primary" />
            VeritaAssure&#8482;
          </Link>

          {/* Resources dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                ["/resources","/faq","/book","/study-guide","/roadmap","/getting-started"].some(p => location.startsWith(p))
                  ? "text-foreground bg-secondary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )}>
                Resources
                <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem asChild>
                <Link href="/getting-started" className="flex items-start gap-2 py-2">
                  <ListChecks size={15} className="mt-0.5 text-primary shrink-0" />
                  <div>
                    <div className="text-sm font-medium">Getting Started</div>
                    <div className="text-xs text-muted-foreground">Set up your lab step by step</div>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/resources" className="flex items-start gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium">Articles</div>
                    <div className="text-xs text-muted-foreground">Clinical lab knowledge base</div>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/book" className="flex items-start gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium">Lab Management 101</div>
                    <div className="text-xs text-muted-foreground">Book for new lab leaders</div>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/study-guide" className="flex items-start gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium">Study Guide</div>
                    <div className="text-xs text-muted-foreground">Which study do I need?</div>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/roadmap" className="flex items-start gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium">Roadmap</div>
                    <div className="text-xs text-muted-foreground">Product development status</div>
                  </div>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/faq" className="flex items-start gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium">FAQ</div>
                    <div className="text-xs text-muted-foreground">Common questions answered</div>
                  </div>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Operations — direct link to the operations tile page */}
          <Link
            href="/operations"
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              ["/operations","/veritabench","/veritabench/staffing","/veritabench/pi","/veritastock","/veritaops-app","/calculator"].some(p => location === p || location.startsWith(p + "/"))
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}
          >
            <BarChart3 size={13} className="text-primary" />
            Operations
          </Link>

          {/* Live Demo */}
          <Link href="/demo" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20">
            <Play size={11} /> Live Demo
          </Link>

          {/* Contact */}
          <Link href="/contact" className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            isActive("/contact") ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
            Contact
          </Link>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* The CLIA cert active-through chip from Wave A6 (PR #627 +
              polish #643) was removed 2026-06-08 per director feedback
              on the vendor management Gate 3 walk: the chip pushed the
              lab switcher and right-cluster buttons off-screen on
              standard viewports, and the expiration date is not a
              top-line concern. The per-row CLIA active-through display
              inside the LabSwitcher dropdown (LabSwitcher.tsx) stays;
              it's on-demand and useful when picking a lab. The
              cliaCertExpirationDate field still flows on /api/labs/me
              for any future consumer. */}
          {isLoggedIn && <LabSwitcher />}
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="w-8 h-8" aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </Button>

          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden lg:flex gap-1.5">
                  <User size={13} />
                  {user?.name.split(" ")[0]}
                  <ChevronDown size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild><Link href={labRoute("/dashboard")}>My Studies</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href={labRoute("/account/settings")}>Account</Link></DropdownMenuItem>
                {showMembersLink && membersHref && (
                  <DropdownMenuItem asChild><Link href={membersHref}>Lab Members</Link></DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut size={13} className="mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild size="sm" variant="outline" className="hidden lg:flex">
              <Link href="/login">Sign in</Link>
            </Button>
          )}

          {/* Standalone "My Studies" button removed to reclaim horizontal space
              for "Run a Study" on standard viewports. My Studies is still
              accessible via the User dropdown above (DropdownMenuItem
              -> /dashboard). */}

          <Button asChild size="sm" className="hidden lg:flex bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
            <Link href="/veritacheck">Run a Study</Link>
          </Button>

          {/* Mobile menu toggle */}
          <Button variant="ghost" size="icon" className="lg:hidden w-8 h-8" onClick={() => mobileOpen ? closeMobile() : setMobileOpen(true)}>
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>
        </div>
      </div>

      {/* Mobile menu — collapsible IA mirroring the desktop nav. Container
          is height-capped + scrollable so a long phone viewport never strands
          the bottom CTAs off-screen. */}
      {mobileOpen && (
        <div
          className="lg:hidden border-t border-border bg-card flex flex-col overflow-y-auto"
          style={{ maxHeight: "calc(100vh - 4rem)" }}
        >
          <div className="px-4 py-3 flex flex-col gap-1">
            {/* Top-level marketing links */}
            {mobileTopLinks.map(({ href, label }) => (
              <Link key={href} href={href} onClick={closeMobile}
                className="px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-secondary transition-colors">
                {label}
              </Link>
            ))}

            {/* 2026-06-08: mobile lab switcher. The desktop dropdown
                (LabSwitcher above) is "hidden lg:flex" so iPhone Safari
                users had no way to switch labs. This inline list mirrors
                the dropdown's content and closes the drawer after a
                successful switch. Renders null when the user has fewer
                than 2 memberships. */}
            {isLoggedIn && <LabSwitcherMobile onAfterSwitch={closeMobile} />}

            <MobileGroup
              label="VeritaAssure™"
              icon={<ShieldCheck size={14} className="text-primary" />}
              expanded={mobileExpanded.has("va")}
              onToggle={() => toggleMobileGroup("va")}
              links={mobileVeritaassureLinks}
              onLinkClick={closeMobile}
            />
            <MobileGroup
              label="Resources"
              expanded={mobileExpanded.has("res")}
              onToggle={() => toggleMobileGroup("res")}
              links={mobileResourcesLinks}
              onLinkClick={closeMobile}
            />
            <MobileGroup
              label="Operations"
              icon={<BarChart3 size={14} className="text-primary" />}
              expanded={mobileExpanded.has("ops")}
              onToggle={() => toggleMobileGroup("ops")}
              links={mobileOperationsLinks}
              onLinkClick={closeMobile}
            />

            {mobileFooterLinks.map(({ href, label }) => (
              <Link key={href} href={href} onClick={closeMobile}
                className="px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-secondary transition-colors">
                {label}
              </Link>
            ))}

            {/* Live Demo CTA */}
            <Link href="/demo" onClick={closeMobile}
              className="px-3 py-2 rounded-md text-sm font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 inline-flex items-center gap-1.5">
              <Play size={11} /> Live Demo
            </Link>

            <div className="pt-2 border-t border-border mt-2 flex gap-2">
              {isLoggedIn ? (
                <>
                  <Button asChild variant="outline" size="sm" className="flex-1"><Link href={labRoute("/dashboard")} onClick={closeMobile}><LayoutDashboard size={13} className="mr-1" />My Studies</Link></Button>
                  <Button variant="outline" size="sm" onClick={() => { logout(); closeMobile(); }} className="flex-1">Sign out</Button>
                </>
              ) : (
                <Button asChild variant="outline" size="sm" className="flex-1"><Link href="/login" onClick={closeMobile}>Sign in</Link></Button>
              )}
              <Button asChild size="sm" className="flex-1 bg-primary text-primary-foreground"><Link href="/veritacheck" onClick={closeMobile}>Run a Study</Link></Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

// MobileGroup — collapsible section for the mobile menu. Used for the
// VeritaAssure, Resources, and Operations buckets so the first-open list
// stays short. Indented sub-links match the desktop dropdown contents.
function MobileGroup({
  label, icon, expanded, onToggle, links, onLinkClick,
}: {
  label: string;
  icon?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  links: { href: string; label: string }[];
  onLinkClick: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-secondary transition-colors"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <ChevronDown
          size={14}
          className="transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border pl-2">
          {links.map(({ href, label: linkLabel }) => (
            <Link key={href} href={href} onClick={onLinkClick}
              className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              {linkLabel}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
