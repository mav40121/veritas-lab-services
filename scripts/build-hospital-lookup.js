#!/usr/bin/env node
/**
 * Build hospital lookup JSON from CMS Provider of Services file.
 * Downloads the latest POS Hospital & Non-Hospital Facilities CSV
 * and extracts hospitals with bed counts > 0.
 *
 * Usage: node scripts/build-hospital-lookup.js
 * Output: server/data/hospitals.json
 */
const fs = require('fs');
const path = require('path');

// Simple CSV parser that handles quoted fields
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const inputFile = process.argv[2] || '/tmp/pos_hospital.csv';
if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

const data = fs.readFileSync(inputFile, 'utf-8');
const lines = data.split('\n');
const headers = parseCSVLine(lines[0]);

const colIndex = {};
headers.forEach((h, i) => { colIndex[h] = i; });

const hospitals = [];
let skipped = 0;

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const fields = parseCSVLine(lines[i]);

  const facName = (fields[colIndex['FAC_NAME']] || '').trim();
  const stateCd = (fields[colIndex['STATE_CD']] || '').trim();
  const zipCd = (fields[colIndex['ZIP_CD']] || '').trim().slice(0, 5);
  const prvdrNum = (fields[colIndex['PRVDR_NUM']] || '').trim();
  const prvdrCat = (fields[colIndex['PRVDR_CTGRY_CD']] || '').trim();

  // Bed count: certified beds first, then total beds
  let bedStr = (fields[colIndex['CRTFD_BED_CNT']] || '').trim();
  if (!bedStr || bedStr === '0') {
    bedStr = (fields[colIndex['BED_CNT']] || '').trim();
  }
  const beds = parseInt(bedStr) || 0;

  // Only hospitals (category 01) with beds > 0
  if (prvdrCat !== '01' || beds <= 0 || !facName) {
    skipped++;
    continue;
  }

  hospitals.push({
    name: facName,
    nameNormalized: facName.toLowerCase(),
    state: stateCd,
    zip: zipCd,
    beds: beds,
    facilityType: 'hospital',
    ccn: prvdrNum,
  });
}

hospitals.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

const outPath = path.join(__dirname, '..', 'server', 'data', 'hospitals.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(hospitals));

console.log(`Parsed ${lines.length - 1} rows, extracted ${hospitals.length} hospitals, skipped ${skipped}`);
console.log(`Output: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
