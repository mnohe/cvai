ARG BASE_IMAGE=alpine:3.23
FROM ${BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CVAI_DATA=/data \
    PORT=8080

RUN apk add --no-cache \
    bubblewrap \
    ca-certificates \
    py3-pip \
    py3-yaml \
    python3 \
    typst \
  && update-ca-certificates

WORKDIR /app

COPY requirements.txt /app/requirements.txt

RUN pip3 install --break-system-packages --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8080

CMD ["python3", "-m", "cvai_web", "serve"]
