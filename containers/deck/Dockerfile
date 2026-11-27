# Container "DeckService": o deck-service (Python + python-pptx + LibreOffice).
# Contexto de build: o diretório pai de atlas/ (wrangler: image_build_context ".."), o mesmo de ../deck-service/Dockerfile.
# Cópia daquele Dockerfile com app/calc.py e app/config.py a mais: app/deck/build.py faz `from .. import calc, config`, e a imagem
# de ../deck-service/Dockerfile não os traz (ImportError na subida, o container reinicia em loop). Manter os dois em sincronia com o deck.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY deck-service/requirements.txt deck-service/requirements.txt
RUN pip install --no-cache-dir -r deck-service/requirements.txt
COPY app/schemas.py app/calc.py app/config.py app/__init__.py app/
COPY app/deck app/deck
COPY deck-service deck-service
WORKDIR /srv/deck-service
EXPOSE 8180
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8180"]
