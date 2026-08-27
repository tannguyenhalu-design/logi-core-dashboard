# SD3 Cloud Scraper — chạy trên Railway thay cho máy tính cá nhân

Toàn bộ logic scrape (KPI portal, raw_ontime, Rillnet) giữ nguyên 100% —
chỉ chuyển chỗ chạy từ laptop Windows sang container luôn bật trên Railway.

## Kiến trúc

- Chrome thật (không phải Chromium) chạy trong màn hình ảo (Xvfb).
- noVNC expose ra 1 URL công khai — mở bằng trình duyệt thường để đăng nhập
  Google/Rillnet/KPI portal **1 lần duy nhất**, y hệt bước "mở Chrome bot,
  đăng nhập 1 lần" trên máy cũ.
- Session đăng nhập lưu vào Volume (`/data/chrome-profile`) — sống sót qua
  mọi lần redeploy/restart, không phải đăng nhập lại.
- Cron chạy 3 lần/ngày (8h50, 12h50, 17h50 giờ VN) — gọi 3 script Python y
  hệt bản trên máy Windows, chỉ đổi đường dẫn.

## Các bước deploy

### 1. Tạo service trên Railway
- Tạo project mới trên Railway → "Deploy from GitHub repo" → chọn repo này.
- Trong Settings của service, đặt **Root Directory** = `cloud-scraper`.
- Railway sẽ tự nhận `railway.json` + `Dockerfile` trong thư mục này.

### 2. Thêm Volume
- Trong tab "Volumes" của service → Add Volume.
- Mount path: `/data`
- (Đây là nơi lưu Chrome profile đã đăng nhập + log — không mount là mất
  đăng nhập mỗi lần restart.)

### 3. Set biến môi trường (Variables tab)
| Biến | Giá trị |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | y hệt giá trị đang dùng trên Vercel (JSON 1 dòng) |
| `GOOGLE_SHEET_ID` | y hệt giá trị đang dùng trên Vercel |
| `KPI_SYNC_SECRET` | y hệt giá trị trong `.env.local` |
| `RILLNET_SYNC_SECRET` | y hệt giá trị trong `.env.local` |
| `VNC_PASSWORD` | **tự đặt 1 mật khẩu** — bắt buộc, không thì ai có link cũng xem/điều khiển được Chrome đang đăng nhập nội bộ GHN. **Giới hạn kỹ thuật của giao thức VNC: chỉ dùng được tối đa 8 ký tự đầu**, đặt dài hơn cũng bị cắt còn 8 — không phải lỗi, mọi VNC server đều vậy. Chỉ cần đủ dùng cho việc đăng nhập 1 lần rồi tắt Public Networking đi. |
| `TELEGRAM_BOT_TOKEN` | tuỳ chọn — báo lỗi qua Telegram khi 1 lần chạy fail |
| `TELEGRAM_CHAT_ID` | tuỳ chọn, đi kèm biến trên |

### 4. Deploy
Railway tự build + chạy. Chờ vài phút cho build xong.

### 5. Đăng nhập lần đầu (1 lần duy nhất)
- Vào tab "Settings" → "Networking" → bật **Public Networking** để có URL
  public (dạng `xxx.up.railway.app`).
- Mở URL đó bằng trình duyệt thường → nhập `VNC_PASSWORD` đã đặt ở bước 3.
- Mày sẽ thấy màn hình Chrome y hệt máy Windows — đăng nhập Google (tài
  khoản đã được cấp quyền xem raw_ontime), Rillnet, KPI portal, y hệt bước
  từng làm trên `chrome-bot-profile`.
- Xong thì thôi, không cần mở lại noVNC nữa (nên tắt Public Networking đi
  sau khi đăng nhập xong, đỡ lộ ra ngoài internet).

### 6. Kiểm tra
- Log tại `/data/scraper_log.txt` bên trong container (xem qua Railway's
  "Shell" tab trong service, gõ `cat /data/scraper_log.txt`), hoặc đợi tới
  giờ chạy theo lịch rồi kiểm tra dashboard có số liệu mới không.

## Khác gì so với máy Windows cũ

| | Máy Windows | Railway |
|---|---|---|
| Cần máy bật | Có | Không |
| Encoding path tiếng Việt | Từng gây lỗi im lặng | Không áp dụng (Linux, path ASCII) |
| Theo dõi khi lỗi | Không có gì, phải tự phát hiện | Có thể báo Telegram |
| Chi phí | 0đ (dùng máy sẵn có) | Tuỳ gói Railway (đã có tài khoản trả phí sẵn) |
