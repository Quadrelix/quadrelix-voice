"""
tests/test_analyze_log.py — the threshold table from labelled scores.

Pure Python (no torch, no model): it only exercises analyze_log.py.
"""

import json
import os
import sys

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVICE_DIR)

import analyze_log as al  # noqa: E402


def rows(label, scores, decision="accepted", speaker="shop_a_owner"):
    return [{"speaker_id": speaker, "score": s, "decision": decision, "label": label} for s in scores]


def test_groups_and_ignores_unlabelled_and_too_short():
    data = (
        rows("owner", [0.7, 0.6])
        + rows("other", [0.1])
        + rows("owner", [0.0], decision="too_short")
        + [{"speaker_id": "shop_a_owner", "score": 0.9, "decision": "accepted"}]  # no label
    )
    scores, short, unlabelled = al.prepare(data)
    assert scores["owner"] == [0.7, 0.6]
    assert scores["other"] == [0.1]
    assert short["owner"] == 1
    assert unlabelled == 1


def test_recommends_the_lowest_frr_with_zero_false_accepts():
    data = (
        rows("owner", [0.80, 0.75, 0.62, 0.50, 0.41])
        + rows("owner_noisy", [0.55, 0.45])
        + rows("other", [0.20, 0.28, 0.33])
        + rows("tv", [0.15, 0.24])
    )
    scores, _, _ = al.prepare(data)
    table = al.sweep(scores, 0.20, 0.60, 0.02)
    best, why = al.recommend(table)
    assert why == "ok"
    assert best["false_accepts"] == 0
    assert best["threshold"] > 0.33          # must exceed the loudest stranger
    assert best["false_rejects"] == 0        # and still keep every owner clip


def test_refuses_to_guess_when_a_stranger_scores_as_high_as_the_owner():
    data = rows("owner", [0.50, 0.45, 0.40]) + rows("other", [0.52, 0.30])
    scores, _, _ = al.prepare(data)
    best, why = al.recommend(al.sweep(scores, 0.20, 0.60, 0.02))
    # zero false accepts needs a threshold above 0.52, which rejects every owner clip
    assert best is None or best["frr"] > al.MAX_FALSE_REJECT
    assert why != "ok"


def test_needs_both_kinds_of_clips():
    scores, _, _ = al.prepare(rows("owner", [0.6, 0.7]))
    best, why = al.recommend(al.sweep(scores, 0.2, 0.6, 0.02))
    assert best is None and "BOTH" in why


def test_speaker_filter_and_jsonl_loading(tmp_path):
    p = tmp_path / "log.jsonl"
    lines = rows("owner", [0.7], speaker="shop_a_owner") + rows("other", [0.1], speaker="shop_b_owner")
    p.write_text("\n".join(json.dumps(r) for r in lines) + "\nnot json\n", encoding="utf-8")
    loaded = al.load_rows(str(p))
    assert len(loaded) == 2  # the bad line is skipped
    scores, _, _ = al.prepare(loaded, speaker="shop_a_owner")
    assert list(scores) == ["owner"]


def test_csv_export_from_neon(tmp_path):
    p = tmp_path / "export.csv"
    p.write_text(
        "ts,speaker_id,score,threshold,duration_s,decision,label\n"
        "2026-11-04T10:00:00Z,shop_a_owner,0.71,0.3,4.2,accepted,owner\n"
        "2026-11-04T10:00:09Z,shop_a_owner,0.12,0.3,3.1,rejected,tv\n"
        "2026-11-04T10:00:19Z,shop_a_owner,0.64,0.3,3.0,accepted,\n",
        encoding="utf-8",
    )
    scores, _, unlabelled = al.prepare(al.load_rows(str(p)))
    assert scores["owner"] == [0.71] and scores["tv"] == [0.12]
    assert unlabelled == 1


def test_cli_runs_end_to_end(tmp_path, capsys):
    p = tmp_path / "log.jsonl"
    data = rows("owner", [0.8, 0.7, 0.6]) + rows("other", [0.2, 0.1]) + rows("tv", [0.15])
    p.write_text("\n".join(json.dumps(r) for r in data), encoding="utf-8")
    code = al.main([str(p)])
    out = capsys.readouterr().out
    assert code == 0
    assert "RECOMMENDED threshold" in out


def test_assume_owner_counts_normal_billing_rows_as_the_owner():
    billing = [{"speaker_id": "shop_a_owner", "score": s, "decision": "accepted"} for s in (0.82, 0.77, 0.69)]
    data = billing + rows("other", [0.2, 0.1]) + rows("tv", [0.15])

    scores, _, unlabelled = al.prepare(data)  # default: unlabelled rows are ignored
    assert "owner_billing" not in scores and unlabelled == 3

    scores, _, unlabelled = al.prepare(data, assume_owner=True)
    assert scores["owner_billing"] == [0.82, 0.77, 0.69] and unlabelled == 0
    best, why = al.recommend(al.sweep(scores, 0.20, 0.60, 0.02))
    assert why == "ok" and best["false_accepts"] == 0 and best["false_rejects"] == 0
