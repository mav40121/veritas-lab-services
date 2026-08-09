import { buildWasteReport, generateWasteReportPDF, generateWasteReportExcel } from "./server/wasteReport";
import { writeFileSync } from "node:fs";
const E = (id:number,name:string,dept:string,vendor:string,reason:string,qty:number,cost:number,date:string,loc:string,by:string) =>
  ({ id, item_id:id, item_name:name, department:dept, vendor, catalog_number:null, qty, unit_cost:cost, waste_value:Math.round(qty*cost*100)/100, reason_code:reason, note:reason==="recalled"?"Manufacturer recall notice 2026-06":null, event_date:date, location_name:loc, actor_name:by });
const events = [
  E(1,"Pfizer Demo - Troponin I Reagent Kit","Chemistry","Ortho","expired",6,185.5,"2026-07-27","Michaels Lab","Michael Veri"),
  E(2,"CBC reagent / diluent pack","Hematology","Sysmex","expired",1,360,"2026-06-10","Michaels Lab","Michael Veri"),
  E(2,"CBC reagent / diluent pack","Hematology","Sysmex","expired",1,360,"2026-07-01","Michaels Lab","Michael Veri"),
  E(3,"Comprehensive Metabolic Panel reagent","Chemistry","Roche","expired",1,415,"2026-06-15","Michaels Lab","Michael Veri"),
  E(3,"Comprehensive Metabolic Panel reagent","Chemistry","Roche","damaged",1,415,"2026-07-05","Michaels Lab","Michael Veri"),
  E(4,"Assayed Chemistry Control, Level 1","Chemistry","Bio-Rad","expired",2,110,"2026-05-20","Michaels Lab","Michael Veri"),
  E(4,"Assayed Chemistry Control, Level 1","Chemistry","Bio-Rad","expired",1,110,"2026-07-10","Michaels Lab","Michael Veri"),
  E(5,"Multi-analyte Calibrator set","Chemistry","Bio-Rad","expired",1,255,"2026-06-22","Michaels Lab","Michael Veri"),
  E(6,"PT / INR thromboplastin reagent","Coagulation","Werfen","recalled",2,305,"2026-06-30","Michaels Lab","Michael Veri"),
  E(7,"Blood culture bottles, aerobic","Microbiology","BD BACTEC","lost",1,150,"2026-07-12","Michaels Lab","Michael Veri"),
  E(8,"Nitrile exam gloves, Medium","Materials Mgmt","Medline","damaged",1,105,"2026-07-18","Michaels Lab","Michael Veri"),
];
const report = buildWasteReport(events as any);
const ctx = { labName:"Michaels Lab", cliaNumber:"55D5555555", preparedBy:"Michael Veri", rangeLabel:"May 1, 2026 to July 28, 2026", locationLabel:"All locations", reasonLabel:null };
const pdf = await generateWasteReportPDF(report, ctx as any);
writeFileSync(process.argv[2] + "/waste.pdf", pdf);
const xlsx = await generateWasteReportExcel(report, ctx as any);
writeFileSync(process.argv[2] + "/waste.xlsx", xlsx);
console.log("wrote waste.pdf", pdf.length, "bytes; waste.xlsx", xlsx.length, "bytes");
