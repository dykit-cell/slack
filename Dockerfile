# Ubuntu 22.04 をベースにする
FROM ubuntu:22.04

# パッケージリストを更新し、libasound2 をインストール
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends libasound2 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# デフォルトのコマンド（コンテナ起動時に実行される）
CMD ["/bin/bash"]