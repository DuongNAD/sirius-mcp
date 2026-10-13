[English](README.md) | Tiếng Việt

# Sirius MCP

*Được đặt tên theo ngôi sao mà lần xuất hiện đầu tiên của nó trước bình minh đã định ra lịch của Ai Cập cổ đại: Sirius giữ thời gian và canh hạn chót.*

Sirius là vòng lặp thực thi trong hệ sinh thái MCP của người học: canh hạn chót theo quy tắc cố định, phân loại việc quá hạn, định tuyến lịch hôm nay, cam kết "nếu - thì" (implementation intentions), bấm giờ phiên học, và tổng kết tuần so sánh kế hoạch với thực tế: giờ học thật đặt cạnh ngân sách tuần và những gì Vega, Orion, Aurora, Mira, Polaris, Rigel và git đã ghi lại.

---

## Hệ sinh thái

Toàn bộ dự án phát triển bởi DuongNAD:

| Dự án | Vai trò | Kho lưu trữ (Repository) |
| :--- | :--- | :--- |
| **Polaris** | Kiến trúc sư lộ trình & giáo trình học | [polaris-mcp](https://github.com/DuongNAD/polaris-mcp) |
| **Aurora Slides** | Động cơ bài giảng, sổ tay & trắc nghiệm | [aurora-slides-mcp](https://github.com/DuongNAD/aurora-slides-mcp) |
| **Mira** | Phòng dò code (phát sự kiện dự đoán vào tiến độ Aurora) | [mira-mcp](https://github.com/DuongNAD/mira-mcp) |
| **SmartDrive-OS** | Quản trị SSD & tìm kiếm tài liệu học | [smart-drive-os](https://github.com/DuongNAD/smart-drive-os) |
| **Constellation** | Đăng ký & kiểm chuẩn hợp đồng MCP | [constellation-mcp](https://github.com/DuongNAD/constellation-mcp) |
| **Vega** | Động cơ ghi nhớ giãn cách tương thích (FSRS) | [vega-mcp](https://github.com/DuongNAD/vega-mcp) |
| **Orion** | Phòng thực hành, kiểm thử thực tế & thang gợi ý | [orion-mcp](https://github.com/DuongNAD/orion-mcp) |
| **Sirius** | Hạn chót, phân loại việc, lịch hôm nay, cam kết, bấm giờ & tổng kết tuần | [sirius-mcp](https://github.com/DuongNAD/sirius-mcp) |

---

## Vì sao cần Sirius?

Hub có nhiều kế hoạch nhưng ít phiên học thật sự được thực hiện. Ngày 2026-10-12 có khoảng 60 task chưa tick đã quá hạn (phần lớn thuộc kế hoạch v1 đã được lộ trình v2 thay thế mà chưa đóng), bộ Vega có 4 thẻ và 0 lượt ôn, bài lab Orion đầu tiên có 0 lần chạy, và hồ sơ lập lịch ghi 1,5 giờ/tuần trong khi lộ trình tổng dự trù 14-16 giờ/tuần. Không có gì đo việc thực sự đã làm, nên kế hoạch không học được từ thực tế, và mỗi phiên agent lại tự làm tay quy tắc hạn chót trong `AGENTS.md`.

Sirius biến quy tắc đó thành công cụ, biến kế hoạch thành cam kết "nếu - thì", đo giờ thực tế so với ước lượng và ngân sách tuần, và cho thấy thời gian học khác với thời gian làm công cụ hay lập kế hoạch (meta).

---

## Nguyên tắc cốt lõi

1. **Chỉ đọc tệp của người học**: Sirius không bao giờ sửa, tick hay xóa `TASKS.md`, `ACTIVE_LEARNING.md`, `INDEX.md` hay lộ trình. Trạng thái nằm trong `<hub>/.sirius/`. Ngoại lệ duy nhất là tệp tổng kết tuần tùy chọn `Roadmaps/weekly_reviews/<năm>-W<tuần>.md`.
2. **Chỉ ghi điều người học đã làm hoặc đã quyết định**: `commit`, `start`, `stop`, `log` và `triage record` nhận đầu vào tường minh. Gợi ý phân loại chỉ được ghi sau khi người học xác nhận trong chat.
3. **Bằng chứng chỉ đọc, không ghi**: Sirius đọc Vega, Orion, Aurora, Mira, Polaris, Rigel và git; không bao giờ ghi vào chúng. Với Rigel, Sirius chỉ đếm và không bao giờ ghi lại nội dung câu hỏi.
4. **Không quét đệ quy ổ D:** (SSD ngoài định dạng exFAT): mở tệp theo đường dẫn chính xác; bài lab Orion và tệp tiến độ Aurora/Mira được tìm qua chỉ mục SmartDrive hoặc `SIRIUS_EVIDENCE_DIRS`.
5. **Tiếng Việt cho người học, tiếng Anh cho mã**: kết quả công cụ và guide bằng tiếng Việt có dấu; không dùng emoji.
6. **Kỷ luật công cụ**: TypeScript, một tệp đóng gói `dist/sirius.mjs` qua esbuild, không phụ thuộc lúc chạy, toolchain đặt ngoài dự án (`SIRIUS_TOOLCHAIN`).
7. **Dữ liệu cá nhân ở lại máy**: trước mỗi lần ghi vào `<hub>/.sirius/`, Sirius bảo đảm có `<hub>/.sirius/.gitignore` gồm đúng `# Created by Sirius: personal study data, never commit.` và `*` (tạo nếu thiếu, không bao giờ ghi đè). Journal không vào git ngay cả khi `.gitignore` gốc của hub chưa liệt kê `.sirius/`.

---

## Công cụ MCP & Lệnh CLI

| Công cụ MCP | Lệnh CLI | Chức năng |
|---|---|---|
| `sirius_guide {topic?}` | `sirius guide [topic]` | Đọc guide: overview, deadlines, triage, plan, sessions, week, evidence, rules |
| `sirius_deadlines {hub?, now?, detail?, subject?}` | `sirius deadlines [--detail] [--subject <s>]` | Canh hạn chót: quá hạn (cảnh báo trước), dưới 24 giờ kèm đếm ngược chính xác, 48 giờ, 72 giờ, xa hơn; gộp mục trùng, lệch định dạng, hạn không thống nhất |
| `sirius_triage {action, before?, decisions?}` | `sirius triage suggest\|list\|record` | Gợi ý superseded / parked / active cho việc quá hạn, ghi quyết định người học đã xác nhận, liệt kê quyết định |
| `sirius_today {date?}` | `sirius today [YYYY-MM-DD]` | Ưu tiên hạn chót, tuần mẫu, một bước tiếp theo cho mỗi khóa, ôn tập Vega/Polaris đến hạn, cam kết, bấm giờ, mức tối thiểu hằng ngày |
| `sirius_commit {subject, time, action, minutes, where?, date?}` | `sirius commit <subject> <HH:mm> <minutes> <action...>` | Ghi cam kết "nếu - thì" |
| `sirius_start {subject, estimate_minutes, task?, kind?, commit_id?}` | `sirius start <subject> <estimate_minutes> [task...]` | Bắt đầu bấm giờ |
| `sirius_stop {outcome, note?, minutes?}` | `sirius stop <outcome> [note...] [--minutes n]` | Dừng bấm giờ; tỉ lệ thực tế / ước lượng và tổng hôm nay |
| `sirius_log {subject, minutes, outcome, kind?, task?, estimate_minutes?, date?, start_time?, note?, commit_id?}` | `sirius log <subject> <minutes> <outcome> [task...]` | Ghi một phiên đã học mà không bấm giờ |
| `sirius_week {week?, write?}` | `sirius week [YYYY-MM-DD] [--write]` | Tổng kết tuần: giờ so với ngân sách, bằng chứng, năng lực, ước lượng, hạn chót, bản tóm tắt để chia sẻ |
| `sirius_stats {weeks?}` | `sirius stats [--weeks n]` | Xu hướng nhiều tuần (kèm số câu hỏi có nguồn theo tuần khi Rigel có hoạt động), chuỗi ngày học cho phép bỏ một ngày lẻ, năng lực, tỉ lệ ước lượng, tỉ lệ giữ cam kết |

Tùy chọn chung của CLI: `--hub <đường dẫn>` (mặc định `SIRIUS_HUB`, `POLARIS_HUB`, rồi `D:/02_Learning_Knowledge`), `--now <iso>`, `--json`. Mã thoát 0 khi thành công, 1 khi dùng sai hoặc có lỗi.

Một ngày điển hình: `sirius_deadlines` đầu phiên, `sirius_today`, `sirius_commit`, `sirius_start` / `sirius_stop`, `sirius_triage { action: "suggest" }` (cho người học xem, chỉ ghi điều họ xác nhận), và `sirius_week { write: true }` vào Chủ Nhật.

---

## Sirius đọc gì (và không bao giờ ghi vào)

| Nguồn | Tệp | Dùng để |
|---|---|---|
| Hub học tập | `ACTIVE_LEARNING.md`, `TASKS.md`, `TASKS.md` của từng dự án, `Roadmaps/MASTER_ROADMAP.md` | Hạn chót, danh sách khóa, tuần mẫu, ngân sách, mốc tuần |
| Vega | `.vega/cards.json`, `.vega/reviews.jsonl` | Thẻ đến hạn hôm nay, lượt ôn theo khóa |
| Orion | `lab.json`, `orion-attempts.jsonl` | Số lần chạy, thời gian, kết quả gần nhất (bước tiếp theo `orion_run`) |
| Aurora | `progress.jsonl`, `aurora-progress-*.jsonl` | Số sự kiện theo loại |
| Mira | cùng các tệp tiến độ; sự kiện có `slideId` bắt đầu bằng `mira-stop-` | `Mira dò code a/b đúng` (rating right trên tổng sự kiện predict), tách khỏi số Aurora |
| Polaris | `<thư mục khóa>/polaris/errorlog.md`, `reviews.json`, `schedule.json` | Mục Sổ lỗi mới, bước ôn đến hạn và đã làm, gợi ý `polaris_today` |
| Rigel | `activity.jsonl` trong thư mục Rigel (`SIRIUS_RIGEL_HOME`, rồi `RIGEL_HOME`, rồi `%USERPROFILE%/.rigel`) | Theo khóa: số câu hỏi có nguồn (`search_material`) với độ phủ mạnh / yếu / không, số thẻ đã xuất (`export_flashcards`), số ghi chú đã lưu (`save_note`) |
| git | `git log` của từng thư mục khóa và các repo công cụ | Số commit trong tuần |

Rigel (máy chủ hỏi đáp có nguồn trên tài liệu bài học) ghi mỗi lần gọi công cụ thành một dòng JSON trong `activity.jsonl`. Sirius chỉ đọc tệp này và chỉ đếm: không bao giờ ghi lại nội dung câu hỏi, không ghi vào thư mục Rigel và không tạo gì ở đó. Thiếu tệp thì bỏ qua âm thầm; chỉ khi `SIRIUS_RIGEL_HOME` hoặc `RIGEL_HOME` trỏ tới thư mục không tồn tại mới có ghi chú. Một dòng thuộc về `subject` của nó nếu khớp một khóa của hub, không thì thuộc về `course` qua bí danh khóa (GCI, ML, PM, QC, AMD, ...); dòng không khớp được thì đếm vào mục `khác` kèm ghi chú. Tổng kết tuần thêm `Hỏi đáp có nguồn N (mạnh a, yếu b, không c)` và `Thẻ từ tài liệu M` vào cột bằng chứng (bỏ số 0) và tính chúng là bằng chứng học trong mục "Học và hạ tầng"; `sirius_stats` thêm số câu hỏi có nguồn theo tuần.

Sirius ghi: `<hub>/.sirius/` (`journal.jsonl`, `active.json`, `triage.json`, `.gitignore`) và, chỉ khi `write: true`, `Roadmaps/weekly_reviews/<năm>-W<tuần>.md` (sau đó gọi `smart-drive update <thư mục> --quiet` theo kiểu cố gắng hết sức, không chặn).

---

## Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `SIRIUS_HUB`, `POLARIS_HUB` | Thư mục hub (mặc định `D:/02_Learning_Knowledge`) |
| `SIRIUS_NOW` | Giờ giả lập ISO 8601 (để kiểm thử) |
| `SIRIUS_SMARTDRIVE` | `off`, `false`, `0` hoặc `no` tắt mọi lệnh gọi SmartDrive; `SIRIUS_SMARTDRIVE_CMD` đổi lệnh |
| `SIRIUS_EVIDENCE_DIRS` | Thư mục bổ sung (ngăn cách bằng `;`) chứa lab Orion và tệp tiến độ Aurora/Mira |
| `SIRIUS_TOOLING_DIRS` | Repo công cụ bổ sung (ngăn cách bằng `;`) để so sánh số commit |
| `SIRIUS_RIGEL_HOME`, `RIGEL_HOME` | Thư mục Rigel chứa `activity.jsonl` (thử theo thứ tự này, rồi `%USERPROFILE%/.rigel`); chỉ đọc |
| `SIRIUS_DAILY_MIN` | Mức tối thiểu số phút học mỗi ngày (mặc định 25) |
| `SIRIUS_TOOLCHAIN` | Toolchain build (rồi `ORION_TOOLCHAIN`, `VEGA_TOOLCHAIN`, `POLARIS_TOOLCHAIN`) |

---

## Xây dựng & Kiểm thử

```powershell
$env:SIRIUS_TOOLCHAIN = "C:\Users\Admin\AppData\Local\aurora-slides\toolchain"   # tùy chọn
node scripts/build.mjs --check
node scripts/e2e.mjs
node dist/sirius.mjs deadlines --hub D:/02_Learning_Knowledge
```

---

## Bản quyền

Giấy phép MIT (c) 2026 DuongNAD
