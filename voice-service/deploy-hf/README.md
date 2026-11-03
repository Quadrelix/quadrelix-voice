---
title: BizMate Voice Lock
emoji: 🎙️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 8000
pinned: false
---

Speaker-verification service for BizMate AI (Voice Lock). API only; every
endpoint except `/health` needs the `X-Voice-Token` header. See the main
repository (`docs/VOICE_SERVICE_DEPLOY.md`).
