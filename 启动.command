#!/bin/bash
# 每周作业小管家 —— macOS 一键启动（双击运行）
# 启动后，手机 / 平板连同一个 Wi-Fi，打开屏幕上显示的地址即可共用同一份作业数据。

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  没有找到 Node.js。"
  echo "  请先到 https://nodejs.org 下载安装 LTS 版本，然后再双击本文件。"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭..."
  exit 1
fi

echo "  正在启动「每周作业小管家」，请稍候..."
echo ""
node server.js

echo ""
read -n 1 -s -r -p "  服务已停止，按任意键关闭..."
