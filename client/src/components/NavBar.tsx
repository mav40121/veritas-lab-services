import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthContext";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sun, Moon, Menu, X, ChevronDown, FlaskConical, TestTube, User, LogOut, LayoutDashboard, Play, ListChecks, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Products dropdown items
const productLinks = [
  { href: "/veritaassure", label: "VeritaAssure\u2122 Suite", desc: "All modules overview", highlight: false, badge: null, badgeColor: null },
  { href: "/veritacheck", label: "VeritaCheck\u2122", desc: "EP Study Analysis", highlight: true, badge: "Live", badgeColor: "emerald" },
  { href: "/veritascan", label: "VeritaScan™", desc: "Inspection Readiness", badge: "Live", badgeColor: "emerald" },
  { href: "/veritamap", label: "VeritaMap™", desc: "Test Menu Mapping", badge: "Live", badgeColor: "emerald" },
  { href: "/veritacomp", label: "VeritaComp™", desc: "Competency Management", badge: "In Progress" },
  { href: "/veritastaff", label: "VeritaStaff™", desc: "Personnel Management", badge: "In Progress" },
  { href: "/veritapt", label: "VeritaPT™", desc: "PT Tracking", badge: "New", badgeColor: "emerald" },
  { href: "/veritalab", label: "VeritaLab™", desc: "Certificate Tracking", badge: "New", badgeColor: "emerald" },
  { href: "/book", label: "Lab Management 101", desc: "New Book", badge: "Coming Soon" },
];

const allMobileLinks = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/veritaassure", label: "VeritaAssure\u2122" },
  { href: "/team", label: "Our Team" },
  { href: "/veritacheck", label: "VeritaCheck™" },
  { href: "/cumsum", label: "CUMSUM Tracker" },
  { href: "/veritascan", label: "VeritaScan™" },
  { href: "/veritamap", label: "VeritaMap™" },
  { href: "/veritacomp", label: "VeritaComp™" },
  { href: "/veritastaff", label: "VeritaStaff™" },
  { href: "/veritapt", label: "VeritaPT™" },
  { href: "/veritalab", label: "VeritaLab™" },
  { href: "/book", label: "Book" },
  { href: "/getting-started", label: "Getting Started" },
  { href: "/resources", label: "Resources" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/demo", label: "Live Demo" },
  { href: "/contact", label: "Contact" },
];

export function NavBar() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout, isLoggedIn } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

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

          {/* Services */}
          <Link href="/services" className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            isActive("/services") ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
            Services
          </Link>

          {/* VeritaAssure dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  ["/veritaassure","/veritacheck","/veritascan","/veritamap","/veritacomp","/veritastaff","/veritapt","/veritalab","/book","/cumsum"].includes(location)
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                <ShieldCheck size={13} className="text-primary" />
                VeritaAssure&#8482;
                <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {productLinks.map(({ href, label, desc, badge, badgeColor, highlight }: any) => (
                <DropdownMenuItem key={href} asChild>
                  <Link href={href} className="flex items-start gap-2 py-2">
                    <div>
                      <div className={cn("text-sm font-medium flex items-center gap-1.5", highlight && "text-primary")}>
                        {label}
                        {badge && (
                          <span className={cn(
                            "text-[9px] font-semibold border rounded px-1 py-0.5 leading-none",
                            badgeColor === "emerald"
                              ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/25"
                              : "bg-amber-500/15 text-amber-600 border-amber-500/25"
                          )}>
                            {badge}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Resources dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                ["/resources","/book","/study-guide","/roadmap","/getting-started"].some(p => location.startsWith(p))
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
            </DropdownMenuContent>
          </DropdownMenu>

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
                <DropdownMenuItem asChild><Link href="/dashboard">My Studies</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/account/settings">Account</Link></DropdownMenuItem>
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

          {isLoggedIn && (
            <Button asChild size="sm" variant="outline" className={cn(
              "hidden lg:flex gap-1.5 font-medium",
              location === "/dashboard" && "bg-secondary text-foreground border-border"
            )}>
              <Link href="/dashboard"><LayoutDashboard size={13} />My Studies</Link>
            </Button>
          )}

          <Button asChild size="sm" className="hidden lg:flex bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
            <Link href="/veritacheck">Run a Study</Link>
          </Button>

          {/* Mobile menu toggle */}
          <Button variant="ghost" size="icon" className="lg:hidden w-8 h-8" onClick={() => setMobileOpen(o => !o)}>
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1">
          {allMobileLinks.map(({ href, label }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)}
              className="px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              {label}
            </Link>
          ))}
          <div className="pt-2 border-t border-border mt-2 flex gap-2">
            {isLoggedIn ? (
              <>
                <Button asChild variant="outline" size="sm" className="flex-1"><Link href="/dashboard" onClick={() => setMobileOpen(false)}><LayoutDashboard size={13} className="mr-1" />My Studies</Link></Button>
                <Button variant="outline" size="sm" onClick={logout} className="flex-1">Sign out</Button>
              </>
            ) : (
              <Button asChild variant="outline" size="sm" className="flex-1"><Link href="/login" onClick={() => setMobileOpen(false)}>Sign in</Link></Button>
            )}
            <Button asChild size="sm" className="flex-1 bg-primary text-primary-foreground"><Link href="/veritacheck" onClick={() => setMobileOpen(false)}>Run a Study</Link></Button>
          </div>
        </div>
      )}
    </header>
  );
}
