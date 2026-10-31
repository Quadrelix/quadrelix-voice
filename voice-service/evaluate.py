import glob, os, requests

URL = "http://127.0.0.1:8000"
SPK = "shop_1_owner"

def post(path, kind):
    with open(path, "rb") as f:
        return requests.post(f"{URL}/{kind}",
                             files={"audio": (os.path.basename(path), f)},
                             data={"speaker_id": SPK}, timeout=120)

def clips(folder):
    out = []
    for ext in ("m4a", "wav", "mp3", "aac", "ogg"):
        out += glob.glob(f"clips/{folder}/*.{ext}")
    return sorted(out)

for p in clips("enroll"):
    r = post(p, "enroll")
    print("ENROLL", os.path.basename(p), r.status_code, r.text[:150])

scores = {"owner": [], "other": [], "tv": []}
folders = {"owner": "owner_test", "other": "others", "tv": "tv"}
for group, folder in folders.items():
    for p in clips(folder):
        r = post(p, "verify")
        if not r.ok:
            print("ERR", p, r.text[:150]); continue
        j = r.json()
        s = j.get("score")
        print(f"{group:6} {os.path.basename(p):32} score={s}  {j.get('reason', '')}")
        if s is not None:
            scores[group].append(s)

print("\nthreshold | owner rejected | others accepted | tv accepted")
for t in [0.20, 0.25, 0.30, 0.35, 0.40, 0.45]:
    rej = sum(s < t for s in scores["owner"])
    oa = sum(s >= t for s in scores["other"])
    ta = sum(s >= t for s in scores["tv"])
    print(f"  {t:.2f}    | {rej}/{len(scores['owner'])}            | {oa}/{len(scores['other'])}             | {ta}/{len(scores['tv'])}")