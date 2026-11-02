# Voice Lock speaker-verification service.
# Build:  docker build -t bizmate-voice .
# Run:    docker run -p 8000:8000 -v voice-data:/data \
#           -e VOICE_SERVICE_TOKEN=... bizmate-voice
FROM python:3.12-slim

# ffmpeg decodes the phone's m4a; libsndfile is needed by soundfile.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch: the default Linux wheel pulls ~2 GB of CUDA libraries that a
# CPU-only host never uses. The extra index makes pip prefer the +cpu build.
COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=300 --retries 8 \
      --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY main.py speaker.py store.py ./

# Bake the pretrained ECAPA model into the image so the first request does not
# depend on Hugging Face being reachable.
RUN python -c "import speaker; speaker.load_model()"

# Enrollments and the verify log live on a mounted volume so a redeploy keeps them.
ENV VOICE_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8000
# $PORT lets platforms like Render/Railway inject their own port.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
