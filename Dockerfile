FROM node:20-bullseye

# Python3 と ffmpeg のインストール
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存関係のインストール
COPY package*.json ./
RUN npm install

# ソースコードのコピー
COPY . .

# 環境変数の設定
ENV PYTHON_BIN=python3
ENV PORT=8080

# ---------------------------------------------------
# 【重要】ここが抜けていました！React画面のビルド
# ---------------------------------------------------
RUN npm run build

# サーバーのビルド
RUN npm run server:build

# サーバー起動
CMD ["npm", "run", "server:start"]
