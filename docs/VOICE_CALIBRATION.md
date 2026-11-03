# Voice test (calibration) — threshold kaise chunna hai

Maqsad: Voice Lock ka threshold (abhi 0.30) asli awaaz-on se chunna, taaki dusron (customer, TV)
ki awaaz kabhi pass na ho aur owner ki awaaz mushkil se hi reject ho. Isme **audio store nahi hota**,
sirf score aur label (kaun bola tha).

## Ye kaise kaam karta hai
App ka chhupa hua "Voice test" screen har clip ko shop ki registered awaaz se match karta hai
(`POST /api/calibrate-voice`) aur voice-service log me **score + label** likhta hai. Bill, transcript
ya Sarvam ka koi kharcha nahi. Phir `voice-service/analyze_log.py` us log se threshold table banati hai.

Labels: `owner` (shaant), `owner_noisy` (shor me), `owner_far` (door se) — ye **pass** hone chahiye.
`other` (koi aur), `tv` (TV/radio) — ye **fail** hone chahiye.

## Step by step

### A. Team ka test shop (ghar/office par, M2 ki jagah)
1. `TEST Team` shop `backend/scripts/create-shops.ps1` se ban jaata hai. Uska code sirf team ke paas rahe.
2. Naya APK install, app me ye code daalo.
3. Team ka **ek** insaan "owner" banta hai: Home par "वॉइस लॉक चालू करें" card se 5 vaakya bol kar awaaz register karo.
4. Home par **logo ko 5 baar tezi se tap** karo, "आवाज़ टेस्ट" screen khulegi.
5. Label chuno, mic dabao, ek vaakya bolo, dobara dabao. Jawab: score aur "सही/गलत".
   - `owner`: wahi insaan, shaant jagah, **15 clips**
   - `owner_noisy`: wahi insaan, TV/fan/baat-cheet chalte hue, **10 clips**
   - `owner_far`: wahi insaan, phone se 1–2 meter door, **10 clips**
   - `other`: **kam se kam 3 alag log** (aadmi, aurat, ghar wale), har ek ke **5–7 clips**
   - `tv`: TV/radio/YouTube chalate hue jisme log bol rahe hon, **10 clips**
6. Har clip kam se kam 2 second ka ho (chhoti clip "बहुत छोटी" dikhati hai aur gini nahi jaati).

### B. Asli shop par (pehle din, owner ke saath)
Wahi, bas **shop ke code** se, owner ki registered awaaz ke saamne: owner ke `owner` / `owner_noisy`
clips shop ke asli shor me, aur team/ghar wale `other`, aur `tv`. Isse dukaan ki asli awaaz-condition ka table milta hai.

### C. Log nikalo aur table banao
VM par log: `docker compose exec voice cat /data/verify_log.jsonl > verify_log.jsonl`
(`~/quadrelix-voice/voice-service/deploy` me). Laptop par laane ke liye:
```
scp -i D:\Downloads\bizmate-voice_key.pem azureuser@85.211.253.243:~/quadrelix-voice/voice-service/deploy/verify_log.jsonl .
```
Phir:
```
cd voice-service
python analyze_log.py verify_log.jsonl --speaker <shop_id>_owner
```
(`<shop_id>` jaise `shop_ab12cd`; bina `--speaker` ke saare shops mila kar dikhata hai.)

### D. Table kaise padhein
- **FAR** (others accepted) = dusron ki awaaz kitni baar pass hui. **0 hona chahiye.**
- **FRR** (owner rejected) = owner ki awaaz kitni baar reject hui. **15% se kam** chahiye.
- Script "RECOMMENDED threshold" tabhi deti hai jab dono shart poori hon. Agar koi threshold dono nahi
  deta, to wo yahi batati hai (tab: zyada enrollment clips, ya doosra model, ya sirf tap-mode — M2 ka go/no-go).

### E. Threshold lagana
VM par `deploy/.env` me `VOICE_THRESHOLD=0.xx` likho, phir `docker compose up -d`.
Phir M6 (shadow) me dekho, aur tabhi `enforce` (M7).

## Dhyan rakhna
- Ek "owner" ke liye ek hi shop ka profile hota hai; calibration usi shop ki registered awaaz se match karta hai.
- Test me bolne wale ko lagta hai kuch rok-tok nahi, par **clips ka label sahi chuno**. Galat label = galat threshold.
- `unlabelled` rows (asli billing) analysis me ignore hoti hain.
