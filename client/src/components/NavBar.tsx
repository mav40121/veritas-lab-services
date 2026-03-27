import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthContext";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sun, Moon, Menu, X, ChevronDown, FlaskConical, User, LogOut, LayoutDashboard } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/team", label: "Our Team" },
  { href: "/veritacheck", label: "VeritaCheck", highlight: true },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];

export function NavBar() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout, isLoggedIn } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

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
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(({ href, label, highlight }) => (
            <Link key={href} href={href} className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors font-medium",
              highlight
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : location === href
                  ? "text-foreground bg-secondary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            )}>
              {highlight && <FlaskConical size={13} />}
              {label}
            </Link>
          ))}
        </nav>

        {/* Right */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="w-8 h-8" aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </Button>

          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden md:flex gap-1.5">
                  <User size={13} />
                  {user?.name.split(" ")[0]}
                  <ChevronDown size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild><Link href="/dashboard">My Studies</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link href="/account">Account</Link></DropdownMenuItem>
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut size={13} className="mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild size="sm" variant="outline" className="hidden md:flex">
              <Link href="/login">Sign in</Link>
            </Button>
          )}

          {isLoggedIn && (
            <Button asChild size="sm" variant="outline" className={cn(
              "hidden md:flex gap-1.5 font-medium",
              location === "/dashboard" && "bg-secondary text-foreground border-border"
            )}>
              <Link href="/dashboard"><LayoutDashboard size={13} />My Studies</Link>
            </Button>
          )}

          <Button asChild size="sm" className="hidden md:flex bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
            <Link href="/veritacheck">Run a Study</Link>
          </Button>

          {/* Mobile menu toggle */}
          <Button variant="ghost" size="icon" className="md:hidden w-8 h-8" onClick={() => setMobileOpen(o => !o)}>
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-card px-4 py-3 flex flex-col gap-1">
          {navLinks.map(({ href, label }) => (
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
