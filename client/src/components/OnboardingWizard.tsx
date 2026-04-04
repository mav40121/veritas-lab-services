import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, ArrowRight, Check, MapPin, FlaskConical, ChevronRight } from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import { apiRequest, API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

const ACCREDITATION_OPTIONS = ["CAP", "TJC", "COLA", "CLIA only", "Other"];
const DEPARTMENT_OPTIONS = ["Chemistry", "Hematology", "Coagulation", "Urinalysis", "Blood Bank", "Microbiology", "Other"];
const ROLE_OPTIONS = ["Primary", "Backup", "Satellite", "POC"];

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [, navigate] = useLocation();

  // Step 2 state
  const [labName, setLabName] = useState("");
  const [accreditation, setAccreditation] = useState("CAP");
  const [departments, setDepartments] = useState<string[]>([]);

  // Step 3 state
  const [instrumentName, setInstrumentName] = useState("");
  const [instrumentDept, setInstrumentDept] = useState("");
  const [instrumentRole, setInstrumentRole] = useState("Primary");
  const [addingInstrument, setAddingInstrument] = useState(false);

  const toggleDept = (dept: string) => {
    setDepartments((prev) =>
      prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept]
    );
  };

  const handleExploreDemo = () => {
    completeOnboarding();
    navigate("/demo");
  };

  const completeOnboarding = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/complete-onboarding`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
    } catch {}
    onComplete();
  };

  const handleAddInstrument = async () => {
    if (!instrumentName.trim()) return;
    setAddingInstrument(true);
    try {
      // First create a map with the lab name
      const mapRes = await fetch(`${API_BASE}/api/veritamap/maps`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: labName || "My Lab Map" }),
      });
      const mapData = await mapRes.json();

      if (mapData.id) {
        // Add the instrument
        await fetch(`${API_BASE}/api/veritamap/maps/${mapData.id}/instruments`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            instrument_name: instrumentName,
            role: instrumentRole,
            category: instrumentDept || departments[0] || "Chemistry",
          }),
        });
      }
      setStep(4);
    } catch {
      setStep(4);
    } finally {
      setAddingInstrument(false);
    }
  };

  const handleFinish = () => {
    completeOnboarding();
    navigate("/veritamap-app");
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-xl border-2">
        <CardContent className="p-8">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  s === step ? "bg-primary" : s < step ? "bg-primary/40" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl mx-auto flex items-center justify-center">
                <Shield size={32} className="text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-serif font-bold">Is your lab ready for its next inspection?</h2>
                <p className="text-muted-foreground mt-2">
                  VeritaAssure&#8482; helps you find out - and fix what you find.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button onClick={handleExploreDemo} variant="outline" size="lg" className="w-full">
                  Explore the Demo Lab
                </Button>
                <Button onClick={() => setStep(2)} size="lg" className="w-full bg-primary hover:bg-primary/90 font-semibold">
                  Build My Lab <ArrowRight size={16} className="ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Lab Setup */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-serif font-bold">Set up your lab</h2>
                <p className="text-sm text-muted-foreground mt-1">Tell us about your lab so we can tailor the experience.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="labName" className="text-sm font-medium">Lab Name</Label>
                  <Input
                    id="labName"
                    placeholder="e.g., Memorial Hospital Laboratory"
                    value={labName}
                    onChange={(e) => setLabName(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium">Primary Accreditation</Label>
                  <RadioGroup value={accreditation} onValueChange={setAccreditation} className="mt-2 space-y-2">
                    {ACCREDITATION_OPTIONS.map((opt) => (
                      <div key={opt} className="flex items-center gap-2">
                        <RadioGroupItem value={opt} id={`acc-${opt}`} />
                        <Label htmlFor={`acc-${opt}`} className="text-sm cursor-pointer">{opt}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div>
                  <Label className="text-sm font-medium">Departments</Label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {DEPARTMENT_OPTIONS.map((dept) => (
                      <div key={dept} className="flex items-center gap-2">
                        <Checkbox
                          id={`dept-${dept}`}
                          checked={departments.includes(dept)}
                          onCheckedChange={() => toggleDept(dept)}
                        />
                        <Label htmlFor={`dept-${dept}`} className="text-sm cursor-pointer">{dept}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <Button onClick={() => setStep(3)} size="lg" className="w-full bg-primary hover:bg-primary/90 font-semibold">
                Next <ArrowRight size={16} className="ml-1" />
              </Button>
            </div>
          )}

          {/* Step 3: First Instrument */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-serif font-bold">Add your first instrument</h2>
                <p className="text-sm text-muted-foreground mt-1">You can add more instruments after setup.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="instName" className="text-sm font-medium">Instrument Name</Label>
                  <Input
                    id="instName"
                    placeholder="e.g., Ortho Vitros 5600"
                    value={instrumentName}
                    onChange={(e) => setInstrumentName(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium">Department</Label>
                  <Select value={instrumentDept || departments[0] || ""} onValueChange={setInstrumentDept}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {(departments.length > 0 ? departments : DEPARTMENT_OPTIONS).map((dept) => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium">Role</Label>
                  <Select value={instrumentRole} onValueChange={setInstrumentRole}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((role) => (
                        <SelectItem key={role} value={role}>{role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={handleAddInstrument}
                size="lg"
                className="w-full bg-primary hover:bg-primary/90 font-semibold"
                disabled={!instrumentName.trim() || addingInstrument}
              >
                {addingInstrument ? "Adding..." : "Add Instrument"} <ArrowRight size={16} className="ml-1" />
              </Button>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl mx-auto flex items-center justify-center">
                <Check size={32} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-xl font-serif font-bold">Your lab map is started!</h2>
                <p className="text-muted-foreground mt-2">
                  Add your test menu to unlock compliance intelligence.
                </p>
              </div>
              <Button onClick={handleFinish} size="lg" className="w-full bg-primary hover:bg-primary/90 font-semibold">
                Go to My Lab Map <MapPin size={16} className="ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
