#!/usr/bin/env bash
# scripts/ci-sandbox/finish_sandbox.sh
#
# Finishes the CI sandbox (parking lot #74) once the sandbox OWNER ACCOUNT exists
# on production (a person signs up at /signup; this script never creates accounts).
# Steps: find the owner -> provision the sandbox lab -> mint a 365-day owner JWT ->
# seed the fixtures through the API as that owner -> store the PW_* repo secrets ->
# add Michael (user 17) as admin on the lab -> trigger the playwright-smoke run.
#
# Secrets come from the environment (ADMIN_SECRET, JWT_SECRET pulled from Railway
# in-process by the operator's helper); nothing is printed or written to disk
# except the non-secret PW_* ids. Usage:
#   OWNER_EMAIL='verilabguy+ci-sandbox@gmail.com' ADMIN_SECRET=... JWT_SECRET=... \
#     bash scripts/ci-sandbox/finish_sandbox.sh
set -euo pipefail
BASE="${BASE:-https://www.veritaslabservices.com}"
REPO="${REPO:-mav40121/veritas-lab-services}"
LAB_NAME="${LAB_NAME:-VLS CI Sandbox}"
MICHAEL_USER_ID="${MICHAEL_USER_ID:-17}"
: "${OWNER_EMAIL:?OWNER_EMAIL required}"; : "${ADMIN_SECRET:?ADMIN_SECRET required}"; : "${JWT_SECRET:?JWT_SECRET required}"
HERE="$(cd "$(dirname "$0")" && pwd)"

jsonpost() { curl -sS -X POST -H "Content-Type: application/json" -d "$2" "$BASE$1"; }

# 1. Owner must already exist (404 from the provisioner means it does not).
PROV=$(jsonpost /api/admin/provision-demo-lab "{\"secret\":\"$ADMIN_SECRET\",\"ownerEmail\":\"$OWNER_EMAIL\",\"labName\":\"$LAB_NAME\",\"plan\":\"hospital\"}")
LAB_ID=$(printf '%s' "$PROV" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String(j.labId||(j.lab&&j.lab.id)||""))})')
[ -n "$LAB_ID" ] || { echo "provision failed: $(printf '%s' "$PROV" | cut -c1-200)"; exit 2; }
OWNER_ID=$(printf '%s' "$PROV" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(String((j.lab&&j.lab.owner_user_id)||j.ownerUserId||""))})')
[ -n "$OWNER_ID" ] || { echo "owner id missing from provision response"; exit 2; }
echo "sandbox lab $LAB_ID owned by user $OWNER_ID ($OWNER_EMAIL)"

# 2. Mint the owner token (in memory only).
TOKEN=$(SANDBOX_USER_ID="$OWNER_ID" node "$HERE/mint_token.mjs")

# 3. Seed the fixtures as the owner; capture the PW_* values.
ENVJSON=$(BASE="$BASE" TOKEN="$TOKEN" LAB_ID="$LAB_ID" node "$HERE/seed_sandbox.mjs")
echo "$ENVJSON"

# 4. Repo secrets: token first (never echoed), then the ids.
printf '%s' "$TOKEN" | gh secret set PW_TOKEN --repo "$REPO"
for k in PW_LAB_ID PW_MAP_ID PW_MAP_URL PW_VERIFICATION_PATH PW_PROGRAM_ID PW_EXPECT_EMPLOYEE; do
  v=$(printf '%s' "$ENVJSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(String(JSON.parse(s)[process.argv[1]]||""))})' "$k")
  printf '%s' "$v" | gh secret set "$k" --repo "$REPO"
done
unset TOKEN
echo "secrets set: PW_TOKEN PW_LAB_ID PW_MAP_ID PW_MAP_URL PW_VERIFICATION_PATH PW_PROGRAM_ID PW_EXPECT_EMPLOYEE"

# 5. Michael as admin on the sandbox lab (seat-free membership).
jsonpost /api/admin/add-lab-membership "{\"secret\":\"$ADMIN_SECRET\",\"userId\":$MICHAEL_USER_ID,\"labId\":$LAB_ID,\"role\":\"admin\"}" | cut -c1-160; echo

# 6. First live run of the blocking step.
gh workflow run playwright-smoke.yml --repo "$REPO" --ref main && echo "playwright-smoke dispatched on main; watch: gh run list --workflow playwright-smoke.yml --repo $REPO -L 1"
