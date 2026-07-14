# Plan 001: Make src/data/sets.json the single machine-readable product contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 071b8bb..HEAD -- src/data/sets.js src/Dashboard.jsx scripts/update-prices.py .github/workflows/update-prices.yml README.md`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (Note: `public/data/*.json` changes
> hourly via a scheduled GitHub Actions bot — that churn is expected and is
> NOT drift for this plan.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `071b8bb`, 2026-07-13

## Why this matters

Product metadata (set codes, TCGPlayer product IDs, MSRPs) is currently defined once in a JavaScript file but consumed by three different parsers: the React app imports it as a JS module, the Python scraper reconstructs it with regular expressions, and the CI validation step uses a third, different regex. The Python regex silently substitutes defaults (`msrp=144`, `status='active'`) when a field fails to parse, and its block-matching regex `\{([^}]+)\}` breaks silently on any nested brace or a `}` inside a string. A harmless JS refactor could make the scraper and the frontend disagree about product identity — the join key for every quote, history series, and transaction — without any error. Moving the data to pure JSON gives all three consumers identical bytes and lets validation fail loudly instead of defaulting.

## Current state

Relevant files:

- `src/data/sets.js` — the only definition of tracked products; a 22-entry array `SET_METADATA` of flat objects with keys `code, name, short, released, msrp, block, status, tier, tcgProductId, notes, tcgUrl` (`msrp` and `block` are numbers, everything else strings). First entry (`src/data/sets.js:5-12`):

  ```js
  export const SET_METADATA = [
    {
      code: 'OP-01', name: 'Romance Dawn', short: 'Romance Dawn',
      released: '2022-12-02', msrp: 144, block: 1, status: 'rotated', tier: 'grail',
      tcgProductId: '450086',
      tcgUrl: 'https://www.tcgplayer.com/product/450086/one-piece-card-game-romance-dawn-romance-dawn-booster-box',
      notes: 'Original English set. Cases sold for $80K. Holy grail of OP TCG.',
    },
  ```

- `src/Dashboard.jsx:10` — the only JS consumer:

  ```js
  import { SET_METADATA } from './data/sets.js';
  ```

  (Confirmed by `grep -rn "SET_METADATA" src/` — only `sets.js:5` and `Dashboard.jsx:10,257`.)

- `scripts/update-prices.py:37` and `scripts/update-prices.py:46-69` — the Python regex parser to be replaced:

  ```python
  SETS_JS = ROOT / 'src' / 'data' / 'sets.js'
  ...
  def load_sets():
      """Parse the sets.js file to extract tracked product metadata."""
      text = SETS_JS.read_text()
      sets = []
      # Match each {...} block inside SET_METADATA
      for m in re.finditer(r"\{([^}]+)\}", text, re.DOTALL):
          block = m.group(1)
          def find(key):
              mm = re.search(rf"{key}:\s*['\"]?([^,'\"\n]+)['\"]?", block)
              return mm.group(1).strip() if mm else None
          code = find('code')
          pid = find('tcgProductId')
          msrp = find('msrp')
          status = find('status')
          released = find('released')
          if code and pid:
              sets.append({
                  'code': code,
                  'tcgProductId': pid,
                  'msrp': int(msrp) if msrp and msrp.isdigit() else 144,
                  'status': status or 'active',
                  'released': released,
              })
      return sets
  ```

  Note the current function returns dicts with only 5 keys. Downstream usage in `main()` reads only `s['code']`, `s['tcgProductId']`, `s['status']`, `s.get('released')` (lines 519-525, 552-559, 604, 621) — so returning the full 11-key JSON entries is a strict superset and safe.

- `.github/workflows/update-prices.yml:51` and `:62-63` — the third regex parser (inside the "Validate market data" inline Python step):

  ```python
  set_codes = re.findall(r"code:\s*['\"]([^'\"]+)['\"]", Path("src/data/sets.js").read_text())
  ...
  if len(set_codes) != len(set(set_codes)):
      raise SystemExit("Duplicate set codes found in src/data/sets.js.")
  ```

- `README.md:107` and `README.md:134` — the two doc references to `sets.js`.

Repo conventions: the scraper is **stdlib-only Python by design** (`README.md:173`: "Python 3.11 — scraper (zero dependencies, stdlib only)") — do not add pip packages. The frontend is Vite + React; Vite imports `.json` files natively as a default export, no plugin needed. `package.json` has `"type": "module"`, so `src/data/sets.js` is an ES module that Node can dynamically `import()`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install frontend deps | `npm ci` | exit 0 |
| Build frontend | `npm run build` | exit 0, `dist/` produced |
| Scraper dry run (needs network) | `DRY_RUN=1 python3 scripts/update-prices.py` | exit 0, prints `Loaded 22 tracked sets.`, ends with `DRY_RUN=1 — not writing files.`; writes nothing |
| Load scraper module without network | `python3 -c "import importlib.util; spec=importlib.util.spec_from_file_location('up','scripts/update-prices.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); s=m.load_sets(); print(len(s))"` | prints `22` |

There is no test, lint, or typecheck script in this repo (`package.json` scripts are only `dev`, `build`, `preview`) — the commands above are the full verification surface.

## Scope

**In scope** (the only files you should modify):
- `src/data/sets.json` (create)
- `src/data/sets.js` (delete, last step only)
- `src/Dashboard.jsx` (one import line)
- `scripts/update-prices.py` (the `SETS_JS` constant and `load_sets()`)
- `.github/workflows/update-prices.yml` (the `set_codes = re.findall(...)` line and the duplicate-codes error message)
- `README.md` (lines 107 and 134 only)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch, even though they look related):
- `public/data/*.json` — operational data written by the hourly bot; never hand-edit.
- Any other logic in `scripts/update-prices.py` (fetching, analytics, history) — later plans own those.
- Any other part of `.github/workflows/update-prices.yml` (schedule, commit step).
- `src/main.jsx`, `vite.config.js`, `index.html`.

## Git workflow

- Branch: `advisor/001-shared-sets-json-contract`
- Conventional Commits style, e.g. `refactor: move set metadata to sets.json shared contract`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Generate src/data/sets.json from the existing JS module

From the repo root:

```bash
node -e "import('./src/data/sets.js').then(m => { require('fs').writeFileSync('src/data/sets.json', JSON.stringify(m.SET_METADATA, null, 2) + '\n'); })"
```

This serializes the live module, so the JSON is guaranteed byte-equivalent in content to what the frontend uses today. Do not hand-edit the output.

**Verify**:
```bash
python3 -c "
import json
sets = json.load(open('src/data/sets.json'))
assert isinstance(sets, list) and len(sets) == 22, len(sets)
required = {'code','name','short','released','msrp','block','status','tier','tcgProductId','tcgUrl','notes'}
for s in sets:
    missing = required - set(s)
    assert not missing, (s.get('code'), missing)
    assert isinstance(s['msrp'], int) and isinstance(s['tcgProductId'], str)
codes = [s['code'] for s in sets]
assert len(codes) == len(set(codes))
print('OK', len(sets), 'entries')
"
```
→ prints `OK 22 entries`.

### Step 2: Switch the frontend import

In `src/Dashboard.jsx`, replace line 10:

```js
import { SET_METADATA } from './data/sets.js';
```

with:

```js
import SET_METADATA from './data/sets.json';
```

(JSON modules are a default export in Vite; the named-import form would be undefined.)

**Verify**: `npm ci && npm run build` → exit 0.

### Step 3: Replace the Python regex parser with a strict JSON loader

In `scripts/update-prices.py`:

1. Replace line 37 `SETS_JS = ROOT / 'src' / 'data' / 'sets.js'` with `SETS_JSON = ROOT / 'src' / 'data' / 'sets.json'`.
2. Replace the section comment at line 45 and the whole `load_sets()` function (lines 46-69) with:

```python
# ─── LOAD SET METADATA FROM sets.json ──────────────────────────────────────
def load_sets():
    """Load tracked product metadata; fail loudly on any malformed entry."""
    sets = json.loads(SETS_JSON.read_text())
    if not isinstance(sets, list) or not sets:
        raise RuntimeError(f'{SETS_JSON} must be a non-empty JSON array')
    seen = set()
    for s in sets:
        for key in ('code', 'name', 'released', 'msrp', 'status', 'tcgProductId'):
            if key not in s:
                raise RuntimeError(f'sets.json entry missing {key!r}: {s}')
        if not isinstance(s['msrp'], int):
            raise RuntimeError(f"sets.json msrp must be an integer for {s['code']}")
        if not isinstance(s['tcgProductId'], str) or not s['tcgProductId'].isdigit():
            raise RuntimeError(f"sets.json tcgProductId must be a numeric string for {s['code']}")
        if s['code'] in seen:
            raise RuntimeError(f"Duplicate set code in sets.json: {s['code']}")
        seen.add(s['code'])
    return sets
```

No default values anywhere — a bad entry must crash the run (the workflow's failure mode is then "no commit", which is safe). The `re` import at the top of the file is still used elsewhere (`parse_datetime` is not — but `import re` remains needed only if other uses exist; check with `grep -n "re\." scripts/update-prices.py` — after this change there are no remaining `re.` uses, so also delete the `import re` line 21).

**Verify**:
```bash
python3 -c "import importlib.util; spec=importlib.util.spec_from_file_location('up','scripts/update-prices.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); s=m.load_sets(); assert len(s)==22 and s[0]['code']=='OP-01' and s[0]['tcgProductId']=='450086'; print('OK')"
```
→ prints `OK`.
```bash
grep -cn "re\.finditer\|re\.search" scripts/update-prices.py
```
→ `0`.

### Step 4: Replace the workflow's regex with the same JSON load

In `.github/workflows/update-prices.yml`, inside the "Validate market data" step's inline Python, replace line 51:

```python
set_codes = re.findall(r"code:\s*['\"]([^'\"]+)['\"]", Path("src/data/sets.js").read_text())
```

with:

```python
set_codes = [s["code"] for s in json.loads(Path("src/data/sets.json").read_text())]
```

Also update the error message at line 63 from `"Duplicate set codes found in src/data/sets.js."` to `"Duplicate set codes found in src/data/sets.json."`, and remove the now-unused `import re` at line 47 of the workflow's inline script.

**Verify** (run the validation body locally, exactly as CI does):
```bash
python3 - <<'PY'
import json
from collections import Counter
from pathlib import Path

set_codes = [s["code"] for s in json.loads(Path("src/data/sets.json").read_text())]
market = json.loads(Path("public/data/market.json").read_text())
history = json.loads(Path("public/data/history.json").read_text())
txns = json.loads(Path("public/data/transactions.json").read_text())
quotes = market.get("quotes", {})
positive_quotes = [code for code in set_codes if quotes.get(code, {}).get("price", 0) > 0]
missing_quotes = [code for code in set_codes if code not in quotes]
missing_history = [code for code in set_codes if not history.get(code)]
duplicate_txn_ids = [txn_id for txn_id, count in Counter(t.get("id") for t in txns if t.get("id")).items() if count > 1]
non_sold_txns = [t.get("id") for t in txns if t.get("type") != "SOLD"]

if len(set_codes) != len(set(set_codes)):
    raise SystemExit("Duplicate set codes found in src/data/sets.json.")
if missing_quotes:
    raise SystemExit(f"Missing market quotes for tracked sets: {missing_quotes}")
if len(positive_quotes) != len(set_codes):
    raise SystemExit(f"Non-positive quotes for tracked sets: {sorted(set(set_codes) - set(positive_quotes))}")
if missing_history:
    raise SystemExit(f"Missing chart history for tracked sets: {missing_history}")
if duplicate_txn_ids:
    raise SystemExit(f"Duplicate transaction ids found: {duplicate_txn_ids[:5]}")
if non_sold_txns:
    raise SystemExit(f"transactions.json contains non-sale rows: {non_sold_txns[:5]}")

print(f"Validated {len(positive_quotes)}/{len(set_codes)} tracked quotes, {len(history)} history series, and {len(txns)} sale transactions.")
PY
```
→ prints `Validated 22/22 tracked quotes, 22 history series, and 100 sale transactions.`

### Step 5: Update the two README references, then delete sets.js

1. `README.md:107`: change `│   ├── data/sets.js        # Set metadata (codes, MSRPs, TCG product IDs)` to reference `data/sets.json`.
2. `README.md:134`: change `Append a new entry to `src/data/sets.js`` to `src/data/sets.json` (and note entries must be valid JSON: double-quoted keys/strings, no trailing commas).
3. Confirm nothing still references the JS file, then delete it:

```bash
grep -rn "sets\.js\b" src scripts .github README.md index.html vite.config.js
```
→ no output (the only pre-change hits were `Dashboard.jsx:10`, `update-prices.py:37,45,47,50`, `update-prices.yml:51,63`, `README.md:107,134`, and `sets.js` itself — all handled above).

```bash
git rm src/data/sets.js
```

**Verify**: `npm run build` → exit 0. `ls src/data/` → shows `sets.json` only.

### Step 6 (optional, requires network): end-to-end dry run

```bash
DRY_RUN=1 python3 scripts/update-prices.py
```
→ exit 0; output includes `Loaded 22 tracked sets.` and ends with `DRY_RUN=1 — not writing files.` (Confirmed against the code: the write calls at `scripts/update-prices.py:641-644` sit after the `if DRY_RUN: return` guard at lines 637-639, so this run touches no files. It does hit live TCGPlayer endpoints and takes ~1 minute.) Then `git status --porcelain public/data/` → empty.

If you have no network access, Step 3's importlib verification is the accepted substitute; note that in your report.

## Test plan

No test framework exists in this repo (deliberately — do not add one in this plan). The verification gates above (JSON schema assertion, importlib load, workflow-body run, `npm run build`, optional dry run) are the test plan.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `python3 -c "import json; s=json.load(open('src/data/sets.json')); assert len(s)==22"` exits 0
- [ ] `npm run build` exits 0
- [ ] Step 3's importlib one-liner prints `OK`
- [ ] Step 4's validation script prints `Validated 22/22 ...`
- [ ] `grep -rn "sets\.js\b" src scripts .github README.md` returns nothing; `src/data/sets.js` no longer exists
- [ ] `grep -c "re\." scripts/update-prices.py` returns `0` and `import re` is removed
- [ ] `git status --porcelain` shows only in-scope files modified/added/deleted
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's node command fails or produces a file whose entry count is not 22 or whose entries fail the key assertion — do not hand-write the JSON from memory.
- `src/Dashboard.jsx:10` or `scripts/update-prices.py:46-69` does not match the excerpts above (drift).
- `grep -rn "SET_METADATA"` reveals any consumer other than `src/Dashboard.jsx` — the plan's "only JS consumer" assumption is false.
- After removing `import re` from the scraper, any remaining `re.` usage is found — some other code path uses regex that this plan didn't account for.
- Step 4's local validation run fails for a reason unrelated to your changes (e.g. the bot committed malformed data mid-task).

## Maintenance notes

- Adding a set is now: append a JSON object to `src/data/sets.json`, run the scraper once, commit. If a required key is missing or malformed, the scraper and CI both fail loudly instead of silently defaulting — that is intentional; do not reintroduce fallback defaults.
- Reviewers should scrutinize: that the generated `sets.json` is content-identical to the old `SET_METADATA` (spot-check `OP-01` and `PRB-02`), and that the named-vs-default import change in `Dashboard.jsx` is correct.
- Deferred: a JSON-Schema file for `sets.json` was considered and rejected as over-engineering for 22 entries; the inline validation in `load_sets()` is the contract.
