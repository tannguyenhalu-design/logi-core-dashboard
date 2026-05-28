# Logi Core Dashboard

Đây là hệ thống Dashboard giám sát và phân tích dữ liệu vận tải (LTL và FTL) được tự động trích xuất từ Google Sheets và xử lý bằng Python.

## Cấu trúc Hệ thống

- `index.html`, `style.css`, `app.js`: Mã nguồn Giao diện người dùng (Frontend), sử dụng Chart.js để vẽ biểu đồ trực quan.
- `aggregate.py`: Trái tim của hệ thống (Backend / Data Pipeline). Nó chịu trách nhiệm tải dữ liệu từ Google Sheets, xử lý logic, tính toán KPI và xuất ra định dạng JSON cho giao diện đọc.
- `data/`: Thư mục Cơ sở dữ liệu nội bộ (Local Database). Chứa các file `ltl_historical.csv` và `ftl_historical.csv` lưu trữ dữ liệu vĩnh viễn để chống mất dữ liệu khi Google Sheets bị dọn dẹp.
- `data.js`: Cầu nối trung gian. Chứa dữ liệu dạng JSON được tạo ra bởi `aggregate.py` để nhúng thẳng vào web.

## 🔥 QUAN TRỌNG: Thiết lập Tự động hóa (Cronjob)

Hiện tại, việc cập nhật số liệu cần chạy thủ công lệnh `python aggregate.py`. 
Khi bạn hoặc lập trình viên của bạn thiết lập hệ thống tự động chạy (Cronjob, GitHub Actions, hoặc Windows Task Scheduler), **BẮT BUỘC** phải chạy chuỗi lệnh sau để đảm bảo dữ liệu lịch sử không bị mất:

```bash
# 1. Chạy thuật toán để kéo dữ liệu mới và gộp vào dữ liệu lịch sử
python aggregate.py

# 2. Lưu trữ toàn bộ dữ liệu (Bao gồm dữ liệu mới, dữ liệu lịch sử CSV) lên GitHub
git add aggregate.py data/ltl_historical.csv data/ftl_historical.csv data.js
git commit -m "chore: Auto update dashboard data"
git push
```

> **Lưu ý:** Nếu chỉ chạy `python aggregate.py` mà KHÔNG `git push` các file trong thư mục `data/`, thì trên Vercel hoặc GitHub sẽ không lưu lại được dữ liệu lịch sử của ngày hôm đó!
