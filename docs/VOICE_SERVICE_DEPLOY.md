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
