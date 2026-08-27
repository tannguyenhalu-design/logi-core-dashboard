# Cloud replacement for the local Windows machine + Task Scheduler + Chrome
# combo — same CDP scraping approach, just running on an always-on container
# instead of someone's laptop. Real Chrome (not Chromium) + a virtual display
# (Xvfb) + noVNC so the one-time interactive login (Google / Rillnet / KPI
# portal) can be done from any browser, no local software needed.

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Ho_Chi_Minh

# ── Base tools + timezone ────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates curl unzip \
    tzdata cron \
    python3 python3-pip \
    xvfb x11vnc novnc websockify \
    fonts-liberation fonts-noto fonts-noto-cjk \
    supervisor \
    && ln -fs /usr/share/zoneinfo/$TZ /etc/localtime && dpkg-reconfigure -f noninteractive tzdata \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 (for sync_to_db.js, mirrors what the main app already uses) ──
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Google Chrome (real Chrome, not Chromium — matches the local setup) ─────
RUN wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ───────────────────────────────────────────────────────────────
RUN pip3 install --no-cache-dir requests websocket-client

WORKDIR /app

# ── Node deps (googleapis, for sync_to_db.js) ────────────────────────────────
COPY package.json /app/package.json
RUN npm install --omit=dev

COPY kpi_scraper.py sheet_scraper.py rillnet_scraper.py sync_to_db.js /app/
COPY ftl_scraper.py sync_ftl_to_db.js ftl_enrich_vehicle.py /app/
COPY list_ftl_orders_needing_vehicle.js update_ftl_vehicle_info.js /app/
COPY check_sync_trigger.js mark_sync_complete.js /app/
COPY entrypoint.sh run_scrapers.sh run_ftl_scraper.sh check_and_run_sync.sh /app/
COPY crontab /app/crontab
RUN chmod +x /app/entrypoint.sh /app/run_scrapers.sh /app/run_ftl_scraper.sh /app/check_and_run_sync.sh

# Chrome profile lives on the mounted Volume (Railway: mount at /data) so the
# one-time login survives restarts/redeploys — same principle as
# C:\chrome-bot-profile on the local machine.
ENV CHROME_PROFILE_DIR=/data/chrome-profile

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
