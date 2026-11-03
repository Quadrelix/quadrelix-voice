"""
analyze_log.py — turn labelled verify scores into a threshold table (M2 / M6).

Input: the verify log with a `label` per row (written by the app's calibration
screen). Either the JSONL file from the VM or a CSV export of voice_verify_log
from Neon (columns ts, speaker_id, score, threshold, duration_s, decision, label).

    python analyze_log.py verify_log.jsonl
    python analyze_log.py export.csv --min 0.20 --max 0.60 --step 0.02
    python analyze_log.py verify_log.jsonl --speaker shop_abc123_owner
    python analyze_log.py verify_log.jsonl --assume-owner   # count normal billing rows as the owner

Labels are grouped as:
  allowed (should be accepted):  owner, owner_noisy, owner_far, staff...  (starts with "owner" or "staff")
  blocked (must be rejected):    other, tv, family, customer...           (anything else that is labelled)
Rows without a label (normal shop traffic) are ignored, unless --assume-owner is given: use it
when only the owner spoke to the app during the pilot, and those rows count as owner clips. Rows the service refused as
too_short have no usable score and are counted separately.

Rule used to pick the threshold (same as the roadmap): ZERO false accepts on the
blocked clips first, then the lowest false-reject rate on the allowed clips (it
should stay under 15%). If no threshold satisfies both it says so instead of
guessing.
"""

import argparse
import csv
import json
import sys
from collections import defaultdict

ALLOWED_PREFIXES = ("owner", "staff")
MAX_FALSE_REJECT = 0.15


def is_allowed(label: str) -> bool:
    return label.startswith(ALLOWED_PREFIXES)


def load_rows(path: str):
    rows = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        if path.lower().endswith(".csv"):
            rows = list(csv.DictReader(f))
        else:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    return rows


def prepare(rows, speaker=None, assume_owner=False):
    """-> (scores_by_label, too_short_by_label, ignored_unlabelled)

    assume_owner: rows with no label are normal billing; count them as label "owner_billing".
    """
    scores = defaultdict(list)
    short = defaultdict(int)
    unlabelled = 0
    for r in rows:
        if speaker and r.get("speaker_id") != speaker:
            continue
        label = str(r.get("label") or "").strip().lower()
        if label in ("", "none", "null"):
            if not assume_owner:
                unlabelled += 1
                continue
            label = "owner_billing"
        if str(r.get("decision")) == "too_short":
            short[label] += 1
            continue
        try:
            scores[label].append(float(r["score"]))
        except (KeyError, TypeError, ValueError):
            continue
    return scores, short, unlabelled


def sweep(scores, lo, hi, step):
    allowed = [s for lab, v in scores.items() if is_allowed(lab) for s in v]
    blocked = [s for lab, v in scores.items() if not is_allowed(lab) for s in v]
    table = []
    t = lo
    while t <= hi + 1e-9:
        fr = sum(1 for s in allowed if s < t)
        fa = sum(1 for s in blocked if s >= t)
        table.append({
            "threshold": round(t, 4),
            "false_rejects": fr,
            "allowed": len(allowed),
            "false_accepts": fa,
            "blocked": len(blocked),
            "frr": fr / len(allowed) if allowed else None,
            "far": fa / len(blocked) if blocked else None,
        })
        t += step
    return table


def recommend(table):
    """Lowest false-reject rate among thresholds with zero false accepts (and FRR within limit)."""
    if not table or table[0]["allowed"] == 0 or table[0]["blocked"] == 0:
        return None, "need labelled clips of BOTH kinds (owner and other/tv) to choose a threshold"
    safe = [r for r in table if r["false_accepts"] == 0]
    if not safe:
        return None, "no threshold gives zero false accepts on the blocked clips"
    best = min(safe, key=lambda r: (r["frr"], r["threshold"]))
    if best["frr"] > MAX_FALSE_REJECT:
        return best, f"zero false accepts is possible, but owner false rejects are {best['frr']:.0%} (limit {MAX_FALSE_REJECT:.0%})"
    return best, "ok"


def stats_line(vals):
    if not vals:
        return "-"
    vals = sorted(vals)
    mean = sum(vals) / len(vals)
    return f"n={len(vals):3d}  min={vals[0]:.2f}  mean={mean:.2f}  max={vals[-1]:.2f}"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", help="verify_log.jsonl or a CSV export of voice_verify_log")
    ap.add_argument("--min", dest="lo", type=float, default=0.20)
    ap.add_argument("--max", dest="hi", type=float, default=0.60)
    ap.add_argument("--step", type=float, default=0.02)
    ap.add_argument("--speaker", help="only rows for this speaker_id (e.g. shop_abc123_owner)")
    ap.add_argument("--assume-owner", action="store_true",
                    help="count rows without a label (normal billing) as the owner's own clips")
    args = ap.parse_args(argv)

    scores, short, unlabelled = prepare(load_rows(args.path), args.speaker, args.assume_owner)

    print("\nScores by label")
    for lab in sorted(scores, key=lambda l: (not is_allowed(l), l)):
        kind = "allowed" if is_allowed(lab) else "blocked"
        extra = f"   too_short={short[lab]}" if short.get(lab) else ""
        print(f"  {lab:14s} [{kind}]  {stats_line(scores[lab])}{extra}")
    print(f"  (unlabelled rows ignored: {unlabelled})")

    table = sweep(scores, args.lo, args.hi, args.step)
    print("\nthreshold | owner rejected (FRR) | others accepted (FAR)")
    for r in table:
        frr = "-" if r["frr"] is None else f"{r['false_rejects']}/{r['allowed']} ({r['frr']:.0%})"
        far = "-" if r["far"] is None else f"{r['false_accepts']}/{r['blocked']} ({r['far']:.0%})"
        print(f"  {r['threshold']:.2f}    | {frr:20s} | {far}")

    best, why = recommend(table)
    print()
    if best and why == "ok":
        print(f"RECOMMENDED threshold: {best['threshold']:.2f}  "
              f"(0 false accepts, owner false rejects {best['false_rejects']}/{best['allowed']})")
        return 0
    if best:
        print(f"Best safe threshold {best['threshold']:.2f}, but: {why}")
        return 2
    print(f"No recommendation: {why}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
