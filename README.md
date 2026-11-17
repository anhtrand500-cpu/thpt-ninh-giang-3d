# THPT Ninh Giang – Ký ức sân trường (bản thử nghiệm)

Game 3D đi dạo khuôn viên Trường THPT Ninh Giang , chạy trên trình duyệt.

**Mã nguồn mở** (MIT) — tổ chức [Moundoo Solution](https://github.com/Moundoo-Solution). Bản demo có thể host trên Cloudflare Workers; server multiplayer trong repo là **mẫu tham khảo** — tự `wrangler login` + `npm run deploy` với tài khoản của bạn (không dùng chung production của người khác).
Công nghệ giống trang 12tranphu.mango.pro.vn: **Three.js r170 + JavaScript module thuần**, không build frontend, không file mô hình 3D.

## Chạy local

### Một mình (không cần Node)
```bash
./start.sh              # python3 -m http.server 8765
# Mở http://localhost:8765?nosync
```
Chế độ này **không** có người chơi khác và sổ lưu bút chung (chỉ lưu máy bạn).

### Nhiều người (khuyên dùng)
```bash
npm install             # một lần
npm run dev             # Wrangler — http://localhost:8787
```
Mở **hai tab** cùng `http://localhost:8787` để thử thấy nhau trên sân, chat (`T`), sổ lưu bút chung.

## Nhớ nhân vật (laptop / điện thoại)

Sau lần đầu **Vào trường**, hồ sơ (tên, lớp, đồng phục, …) lưu trong **localStorage** của trình duyệt — cùng link, cùng máy, lần sau bấm **Vào trường** là chơi tiếp, không cần tạo lại.

| Trường hợp | Ghi chú |
|---|---|
| Điện thoại và laptop | **Mỗi thiết bị một bản** (Safari ≠ Chrome, máy khác ≠ máy khác) |
| Xóa cache / chế độ ẩn danh | Mất hồ sơ — tạo lại một lần |
| Đổi nhân vật | Nút tên góc trên, hoặc mở link `?new=1` |
| Lớp học đã vào | Cũng nhớ trong trình duyệt (mã lớp) |

Không có tài khoản đăng nhập — muốn một nhân vật dùng chung mọi nơi cần thêm đăng nhập/server (chưa có trong bản này).

## Chơi trên điện thoại

Không cần cài app riêng — mở **cùng link web** (local hoặc sau khi `npm run deploy`) bằng Safari/Chrome trên điện thoại.

| Thao tác | Cách làm |
|---|---|
| Đi | **Joystick ảo** góc trái dưới — kéo núm tròn |
| Xoay camera | Kéo **nửa phải** |
| Zoom | **Hai ngón** kéo ra/thu vào |
| Nhảy / tương tác | Nút **Nhảy** và **E** góc phải dưới |
| Bản đồ, chat sân, lớp học | Thanh **Bản đồ / Chat / Lớp** phía dưới (thay phím M, T, C) |
| Sổ lưu bút, đổi nhân vật | Góc trên trái như máy tính |

**Thêm vào màn hình chính:** Safari → Chia sẻ → *Thêm vào Màn hình chính* (có `manifest.webmanifest` + icon). Gọi thoại WebRTC cần **https** (bản deploy Cloudflare) hoặc localhost — mở bằng IP trong mạng wifi vẫn chat được nhưng trình duyệt có thể chặn micro.

## Deploy miễn phí (Cloudflare Workers)

Gói **Free** của Cloudflare đủ cho dự án kỷ niệm lớp/trường:

| Hạng mục | Free tier (ước lượng) |
|---|---|
| Workers | ~100.000 request/ngày |
| Durable Object | WebSocket + SQLite sổ lưu bút, ~hibernation khi không ai chơi |
| Tĩnh (`public/`) | Phục vụ HTML/JS qua cùng Worker |

**Các bước:**

1. Tạo tài khoản [Cloudflare](https://dash.cloudflare.com/sign-up) (miễn phí).
2. `npm install -g wrangler && wrangler login`
3. Trong thư mục game: `npm run deploy`
4. Wrangler in URL dạng `https://thpt-ninh-giang.<tài-khoản>.workers.dev` — chia link cho cựu HS/GV.

**Lưu ý:** Lần deploy đầu có thể hỏi bật Durable Objects — chọn Yes. Một phòng `san-truong` duy nhất (cả trường chung một sân); tối đa **100** người cùng lúc (`MAX_PLAYERS` trong `server/worker.js`, Workers Paid).

**Giới hạn / kiểm duyệt nhẹ (trong `server/worker.js`):** lọc ký tự, cooldown chat ~1,2s, gửi lời nhắn sổ ~30s, trống/kẻng ~5s.

### Phương án khác (cũng free, tự host)
- **Fly.io / Render:** container Node + `ws` — cần giữ máy chạy hoặc sleep khi không dùng.
- **PartyKit / Ably trial:** đổi client, bỏ Durable Object.

Dự án hiện chọn **một Worker Cloudflare** vì: không server riêng, HTTPS + WSS sẵn, chi phí $0 nếu traffic vừa phải.

## Lớp học & mời bạn bè
- **Học sinh:** khi vào trường online, game **tự tạo phòng lớp** (nếu chưa có ai) hoặc **tự vào phòng** theo **lớp + niên khóa** trong hồ sơ nhân vật (mã `12A1-2011`). Người sau cùng lớp cùng khóa được add vào cùng phòng, không cần bấm tạo lớp.
- Vẫn có thể bấm **Lớp học** (phím **C**) để xem chat, copy link mời, hoặc vào mã lớp khác thủ công. Mã lớp = `LỚP-NĂM` (VD `12A1-2011`).
- **Sao chép link mời** (`…/?lop=12A1-2011`) gửi qua Zalo/Messenger; người mở link vào trường là tự vào lớp.
- Chat trong lớp chỉ người cùng lớp thấy; lưu 300 tin gần nhất mỗi lớp (SQLite của Durable Object). Game nhớ lớp đã vào ở lần sau.
- API xem nhanh: `GET /api/class?code=12A1-2011`.

## Gặp nhau trên sân
- Nếu không thao tác trong **3 phút**, kết nối sân chung sẽ tạm ngắt để tiết kiệm pin và băng thông; bấm **Kết nối lại ngay** để vào lại.
- **EM HAM HỌC / Math Game:** tương tác với bảng trong sân để vào phòng chung; người đầu tiên làm người dẫn và có thể bắt đầu khi tối đa 40 bạn đã vào. Ván có 15 câu Tích phân (5 câu mỗi mức), công thức LaTeX, 20 giây mỗi câu và tự hiện đáp án / bảng điểm.
- **Chat sân (T):** chỉ người trong 15 m nhận; hiện bong bóng trên đầu người nói.
- **Trò chuyện riêng:** đứng cạnh người khác → **E: Mời … trò chuyện** → người kia **Đồng ý** mới mở khung nhắn riêng (lời mời hết hạn sau 30 s).
- **Gọi thoại:** trong khung riêng bấm **📞 Gọi thoại** → người kia bấm **Nghe**. WebRTC ngang hàng (STUN Google/Cloudflare, không TURN), máy chủ chỉ chuyển tín hiệu. Micro cần https hoặc localhost.

## Cấu trúc
| File | Nội dung |
|---|---|
| `public/js/world.js` | Khuôn viên (layout theo ảnh ~2022) |
| `public/js/textures.js` | Texture vẽ canvas |
| `public/js/character.js` | Nhân vật, bảng tên |
| `public/js/profile.js` | Tạo HS/GV, localStorage |
| `public/js/multiplayer.js` | WebSocket, người chơi từ xa, đồng bộ |
| `public/js/main.js` | Game loop, UI, chat, sổ LB |
| `server/worker.js` | Worker + Durable Object `SchoolRoom` |
| `wrangler.jsonc` | Cấu hình deploy |

Tham số URL: `?start` (bỏ intro), `?nosync` (chơi một mình), `?shot=gate|…` (camera cố định).

## Tư liệu
Ảnh trong `public/reference/`
**Trong trường:** sân rộng (tường rào 124×80 m), mỗi dãy nhà có lồng cầu thang ở một đầu (hai đợt + chiếu nghỉ) để lên hành lang các tầng; va chạm có `bottom` nên sàn tầng trên đi được mà tầng dưới vẫn đi bên dưới lát terrazzo, nhà chính 3 tầng + sân khấu lễ phía trước, hai dãy cánh trái/phải, không cột cờ giữa sân; cổng theo ảnh 2022. **Đối diện cổng** (Google Street View 4/2026, ảnh trong `public/reference/gg-street-*.png`): vỉa hè đá xám, hàng rào sắt xanh hoa văn, đèn cột đôi cầu tròn, cây non chống cọc, sân bóng cỏ nhân tạo có khán đài vàng ba phía, cột đèn cao áp, lưới chắn, nhà thi đấu mái vòm; quán Tuấn Thảo ở góc phía Tây cạnh giàn hoa giấy tím; phía Đông là phố nhà ống. Bên trường: cau vua, cây bồn tròn viền đỏ, cột điện và dây điện.
