FROM node:20-bullseye

# Python3 + ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存関係インストール（dev も含めて全部）
COPY package*.json ./
RUN npm install

# アプリ本体
COPY . .

ENV PYTHON_BIN=python3
ENV PORT=8080

# フロントのビルド
RUN npm run build

# サーバーのビルド
RUN npm run server:build

# Cloud Run 起動コマンド
CMD ["npm", "run", "server:start"]
