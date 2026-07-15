#!/bin/bash
# تشغيل نظام مكتبة دوت كوم على الماك. اضغط عليه مرتين من Finder.
cd "$(dirname "$0")"
echo "جارٍ تشغيل خادم مكتبة دوت كوم..."
python3 server.py &
SERVER_PID=$!
sleep 1
open "http://127.0.0.1:8765/"
echo "الخادم يعمل (PID $SERVER_PID). أغلق هذه النافذة لإيقافه."
wait $SERVER_PID
