# Voice-service ko Oracle Cloud Always Free VM par chalana

Maqsad: pilot ke 7 din `VOICE_LOCK_MODE=shadow` me asli shops ki awaaz score hoti
rahe (kuch block nahi hota), taaki M6 me threshold chuna ja sake.

Architecture: phone -> Render backend -> (HTTPS + token) -> ye VM par voice-service.
Voice-service band ho to `VOICE_FAIL_MODE=open` ki wajah se billing chalti rehti hai.

## 1. Oracle account (ek baar)
1. https://www.oracle.com/cloud/free/ -> Start for free. Card verification chahiye (Always Free resources par charge nahi hota).
2. **Home region** chuno (baad me badal nahi sakte). Mumbai (`ap-mumbai-1`) ya Hyderabad. Agar region me ARM VM available na ho to dusra region try karna padega.

## 2. VM banana
Console -> Compute -> Instances -> Create instance:
- Image: **Ubuntu 24.04 (ya 22.04)**
- Shape: **VM.Standard.A1.Flex (Ampere)**, **2 OCPU / 12 GB RAM** (free limit 4 OCPU / 24 GB tak)
- Boot volume: 50 GB
- Public IPv4: assign
- SSH keys: "Generate a key pair" -> **private key download karke sambhal lo**
- "Out of capacity" aaye to dusra Availability Domain ya baad me try karein.

## 3. Ports kholna (80 aur 443)
Do jagah kholna padta hai:
1. Oracle console: instance -> Subnet -> Security List -> Add Ingress Rules: Source `0.0.0.0/0`, TCP, port **80**, aur dusri rule port **443**.
2. VM ke andar (Oracle ki Ubuntu image me iptables rokta hai):
   ```
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo apt-get update && sudo apt-get install -y iptables-persistent
   sudo netfilter-persistent save
   ```

## 4. VM me login aur Docker
```
ssh -i <private-key-file> ubuntu@<VM-ka-public-IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit        # phir dobara ssh karo, taaki docker group lage
```

## 5. Hostname (HTTPS ke liye naam chahiye, free)
Sabse aasaan: **sslip.io**. IP 1.2.3.4 ho to hostname `voice-1-2-3-4.sslip.io` apne aap us IP par point karta hai (koi signup nahi).
Agar certificate na mile (shared rate limit), to https://www.duckdns.org par free subdomain lo aur use VM ke IP par point karo.

## 6. Code lana aur chalana
```
git clone https://github.com/Quadrelix/quadrelix-voice.git
cd quadrelix-voice
git checkout voice-lock-integration
cd voice-service/deploy
cp .env.example .env
nano .env        # DOMAIN=voice-1-2-3-4.sslip.io  aur  VOICE_SERVICE_TOKEN=$(openssl rand -hex 24) ki value
docker compose up -d --build
docker compose logs -f voice     # "startup complete"/warm-up dikhe tab Ctrl+C
```
Pehli build me torch/model download hota hai (kuch minute).

Test (apne laptop se):
```
curl https://<DOMAIN>/health                                   # ok
curl -i https://<DOMAIN>/status                                # 401 (token ke bina)
curl -H "X-Voice-Token: <TOKEN>" https://<DOMAIN>/status       # 200
```

## 7. Render me env vars
Render -> quadrelix-voice-backend -> Environment:

| Key | Value |
|---|---|
| `VOICE_SERVICE_URL` | `https://<DOMAIN>` |
| `VOICE_SERVICE_TOKEN` | VM wala wahi token |
| `VOICE_LOCK_MODE` | `shadow` |
| `VOICE_FAIL_MODE` | `open` |
| `VOICE_ADMIN_PIN` | koi PIN (reset/re-enroll ke liye) |

Save -> Render redeploy karega. Boot log me `[VOICE LOCK] mode=shadow service=up` dikhna chahiye.

## 8. Shopkeepers ki awaaz register
Har shop owner app me **Voice Lock: set up** se 5 vaakya record kare (ek baar). Bina register ke shadow
mode kuch block nahi karta, par un shops ka score "not_enrolled" hi aayega.

## 9. Data nikalna aur safe rakhna
```
cd ~/quadrelix-voice/voice-service/deploy
docker compose exec voice cat /data/verify_log.jsonl > ~/verify_log_$(date +%F).jsonl
```
Laptop par laane ke liye `scp -i <key> ubuntu@<IP>:~/verify_log_*.jsonl .`.
Roz ek baar copy kar lo. Audio store nahi hota; log me sirf timestamp, shop (speaker_id), score, duration, decision hota hai.

## 10. Dhyan rakhne ki baatein
- Oracle ke Always Free rules badalte rehte hain; dashboard me check karte raho. Idle VM kabhi reclaim ho sakta hai.
- Har clip par verify ~0.5-1 s lagata hai (shadow me bhi, kyunki pehle verify hota hai phir Sarvam). Zyada slow lage to batao.
- Token kisi ko mat do. `.env` git me nahi jaata.
- Roll back: Render me `VOICE_LOCK_MODE=off` kar do. Billing pehle jaisi chalegi.
- Update: `git pull && docker compose up -d --build` (data volume me safe rehta hai).

---

# Option B: Hugging Face Spaces + Neon

> **Nov 2026 update: Hugging Face ne Docker Spaces paid (PRO) kar diye; sirf Static free hai.**
> Isliye ye option ab card ke bina free nahi hai. Neon wala hissa (`VOICE_DATABASE_URL`, `pgstore.py`)
> kisi bhi aise host par kaam aata hai jiska disk restart par saaf hota hai.

Oracle ke liye card chahiye. Card na ho to ye raasta. Fark sirf itna hai ki HF ka disk restart par
saaf ho jaata hai, isliye voice profile aur score log **Neon (Postgres)** me likhe jaate hain
(`VOICE_DATABASE_URL`, code: `voice-service/pgstore.py`). Model, threshold aur scoring bilkul wahi.

## B1. Neon me alag database/role (tumhare backend wale DB se alag)
Neon console -> naya database (ya branch) `voice`. Uski connection string `postgresql://...?sslmode=require` copy karo.
Ye string kisi chat/file me mat daalna.

## B2. Hugging Face Space
1. huggingface.co par free account (card nahi chahiye).
2. New Space -> SDK **Docker** -> name `bizmate-voice` -> Space ko **Private ya Public** (Public theek hai: har endpoint token se band hai, code me koi secret nahi).
3. Space ke Settings -> **Variables and secrets** -> **Secrets** me daalo:
   - `VOICE_SERVICE_TOKEN` = `openssl rand -hex 24` wali value
   - `VOICE_DATABASE_URL` = B1 wali Neon string
   - (optional) `VOICE_THRESHOLD`, `VOICE_MIN_SECONDS`
4. Laptop par (PowerShell):
   ```
   git clone https://huggingface.co/spaces/<user>/bizmate-voice C:\space\bizmate-voice
   cd D:\Desktop\mvp-project-sarvam\voice-service\deploy-hf
   .\make-space.ps1 -SpaceDir C:\space\bizmate-voice
   cd C:\space\bizmate-voice
   git add . ; git commit -m "Voice Lock service" ; git push
   ```
   (push par HF username aur access token maangega: huggingface.co/settings/tokens, "Write".)
5. Space "Building" -> "Running" hone me kuch minute lagte hain. URL: `https://<user>-bizmate-voice.hf.space`.

Test:
```
curl https://<user>-bizmate-voice.hf.space/health                                  # ok
curl -i https://<user>-bizmate-voice.hf.space/status                               # 401
curl -H "X-Voice-Token: <TOKEN>" https://<user>-bizmate-voice.hf.space/status      # 200
```

## B3. Render env vars
Upar step 7 jaisa, bas `VOICE_SERVICE_URL` = `https://<user>-bizmate-voice.hf.space`.

## B4. Space ko jagaye rakhna
Free Space idle rehne par so jaata hai. UptimeRobot (free) par `https://<user>-bizmate-voice.hf.space/health` ko
har 30 minute me ping karwao. So bhi jaaye to `VOICE_FAIL_MODE=open` ki wajah se billing nahi rukti, sirf us waqt ka data nahi milta.

## B5. Data nikalna
Neon SQL editor me:
```sql
SELECT ts, speaker_id, score, threshold, duration_s, decision, label
FROM voice_verify_log ORDER BY ts;
```
Export as CSV. (`label` column calibration mode ke liye reserved hai; abhi khaali rehta hai.)

## B6. Dhyan rakhne ki baatein
- M6 (shadow) ke liye theek. **M7 (enforce) se pehle** always-on host par jaana chahiye: service soyi to fail-open me lock bekaar, fail-closed me bill ruk jaata hai.
- Neon free compute idle par suspend hota hai; pehli write me ~1 second lag sakta hai (log background me likha jaata hai, verify nahi rukta).
- Space ki secrets Neon access deti hain; Neon me sirf voice tables wala alag role/database rakho.
- Baad me paid host par jaana ho to wahi `Dockerfile` chalega, aur `VOICE_DATABASE_URL` wahi rakh sakte ho (data saath chalta hai).

---

# Option C: Azure for Students ($100 credit, card nahi chahiye)

College email (`sitare.org`) se azure.microsoft.com/free/students par account banao. Credit se ek
Linux VM chalti hai. Baaki Docker/Caddy/Render ke steps Oracle wali guide (steps 4-10) jaise hi hain.

## C1. VM banana (portal.azure.com)
Virtual machines -> Create -> Azure virtual machine:
- Subscription: **Azure for Students**; Resource group: naya `bizmate-voice-rg`; Name: `bizmate-voice`
- Region: Central India (ya jo allowed ho; size na mile to dusra region try karo)
- Image: **Ubuntu Server 24.04 LTS (x64)**
- Size: **Standard_B2s** (2 vCPU / 4 GB) ya jo isse milta-julta mile. Portal "cost per month" dikhata hai, wo dekh lo (24/7 chalne par credit kuch mahine chalta hai). Kam se kam 2 GB RAM chahiye.
- Authentication: **SSH public key**, username `azureuser`, "Generate new key pair" -> `.pem` download karke sambhal lo
- Inbound ports: **SSH (22), HTTP (80), HTTPS (443)**
- Disk: Standard SSD (30 GB default theek)
Review + create -> Create.

## C2. Public IP ko static karna
VM -> Networking -> Network interface -> IP configurations -> Public IP -> **Assignment: Static**.
(Warna VM restart par IP badal sakta hai aur hostname toot jaayega.)

## C3. Login aur Docker
PowerShell me:
```
icacls C:\path\key.pem /inheritance:r /grant:r "$($env:USERNAME):R"
ssh -i C:\path\key.pem azureuser@<VM-ka-public-IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker azureuser
exit        # phir dobara ssh karo
```
Azure ki Ubuntu image par Oracle jaisa iptables ka step nahi chahiye.

## C4. Baaki
Oracle wali guide ke step 5 (hostname `voice-<ip-dashes>.sslip.io`), step 6 (clone + `deploy/.env` + `docker compose up -d --build`),
step 7 (Render env vars), step 8-9 (enrollment, data nikalna) waise hi karo. `ubuntu` ki jagah `azureuser` likhna.
`VOICE_DATABASE_URL` optional hai (VM ki disk persistent hai); Neon me bhi logs chahiye to set kar sakte ho.

## C5. Credit bachana
- Kaam na ho to VM ko **Stop (deallocate)** karo, tab compute ka paisa nahi lagta.
- Cost Management me budget alert lagao.
- Pilot ke baad poora resource group delete kar do.
