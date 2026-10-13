export const GUIDE_TOPICS = [
  "overview",
  "deadlines",
  "triage",
  "plan",
  "sessions",
  "week",
  "evidence",
  "rules",
] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export const GUIDE_DOCS: Record<GuideTopic, string> = {
  overview: `# Sirius MCP: Vòng lặp thực thi của hub học tập

Sirius là máy chủ MCP và CLI trong hệ sinh thái của người học (DuongNAD). Tên lấy từ ngôi sao Sirius, nơi lần xuất hiện đầu tiên của nó trước bình minh đã định ra lịch của Ai Cập cổ đại: Sirius giữ thời gian và canh hạn chót.

## Vì sao cần Sirius
Hub có nhiều kế hoạch nhưng ít phiên học thật sự được ghi lại. Không có ai đo thời gian thực tế so với ước lượng, nên kế hoạch không học được từ thực tế. Quy tắc hạn chót trong AGENTS.md cũng bị làm tay mỗi phiên (grep rồi cộng trừ giờ). Sirius biến quy tắc đó thành công cụ có kết quả lặp lại được, biến kế hoạch thành cam kết "nếu - thì", đo giờ thực tế so với ngân sách tuần, và cho thấy thời gian học khác với thời gian làm công cụ.

## Hệ sinh thái (DuongNAD)
- Polaris: kiến trúc sư khóa học, lộ trình, Sổ lỗi.
- Aurora Slides: bài giảng, trang vở, trắc nghiệm, sự kiện tiến độ.
- Mira: phòng dò code (code-tracing), phát sự kiện dự đoán vào tệp tiến độ của Aurora.
- Vega: thẻ ghi nhớ giãn cách (FSRS).
- Orion: bài thực hành có kiểm thử thật.
- SmartDrive-OS: quản trị SSD và chỉ mục tìm kiếm.
- Constellation: đăng ký, kiểm tra sức khỏe và hợp đồng giữa các máy chủ MCP.
- Sirius (máy chủ này): hạn chót, phân loại việc, lịch hôm nay, cam kết, bấm giờ, tổng kết tuần.

## 10 công cụ
| Công cụ | Việc làm |
|---|---|
| sirius_guide | Đọc tài liệu này (đọc đầu tiên) |
| sirius_deadlines | Kiểm tra hạn chót đầu phiên: quá hạn, dưới 24/48/72 giờ |
| sirius_triage | Gợi ý, ghi và liệt kê quyết định phân loại việc quá hạn |
| sirius_today | Lịch hôm nay: ưu tiên hạn chót, tuần mẫu, ôn tập, cam kết |
| sirius_commit | Ghi cam kết "khi - ở - sẽ" |
| sirius_start | Bắt đầu bấm giờ một phiên học |
| sirius_stop | Dừng phiên, ghi giờ thực tế |
| sirius_log | Ghi một phiên đã học mà không bấm giờ |
| sirius_week | Tổng kết kế hoạch và thực tế của tuần |
| sirius_stats | Xu hướng nhiều tuần, chuỗi ngày học, năng lực thực tế |

## Quy trình một ngày
1. Đầu phiên: \`sirius_deadlines\`. Có việc quá hạn thì nói trước mọi việc khác; dưới 24 giờ thì nêu đúng thời gian còn lại và kế hoạch tập trung.
2. \`sirius_today\` để chọn việc trong ngày.
3. \`sirius_commit\` đặt giờ, nơi, bước đầu tiên cụ thể và số phút.
4. \`sirius_start\` trước khi học, \`sirius_stop\` sau khi học (hoặc \`sirius_log\` nếu không bấm giờ).
5. \`sirius_triage { action: "suggest" }\`, cho người học xem, chỉ ghi quyết định họ đã xác nhận.
6. Chủ Nhật: \`sirius_week { write: true }\`.

## Trạng thái
Mọi trạng thái của Sirius nằm trong \`<hub>/.sirius/\` (journal.jsonl, active.json, triage.json). Thư mục này là dữ liệu cá nhân, không đưa lên git. Sirius không bao giờ sửa TASKS.md, ACTIVE_LEARNING.md, INDEX.md hay lộ trình.`,

  deadlines: `# Hạn chót (sirius_deadlines)

Quy tắc trong AGENTS.md, thực hiện bằng công cụ:
- Quá hạn: cảnh báo trước mọi việc khác.
- Dưới 24 giờ: cảnh báo khẩn, nêu đúng thời gian còn lại (ví dụ "còn 23 giờ 12 phút") và kế hoạch tập trung.
- Dưới 48 giờ: dồn buổi học hôm nay vào việc đó.
- Dưới 72 giờ: nhắc, nên chặn sẵn thời gian.
- Xa hơn: theo dõi.

## Nguồn của các mục
1. Dòng task chưa tick có thẻ Deadline trong mọi bảng: TASKS.md trung tâm, bảng của từng dự án (liên kết \`- Tasks:\` trong ACTIVE_LEARNING.md và bảng điều hướng trong TASKS.md) và danh sách theo dõi của ACTIVE_LEARNING.md. Dòng nằm trong khối mã (\`\`\`) và dòng đã tick bị bỏ qua. Không có giờ thì lấy 23:59.
2. Mỗi dự án đang học có \`- Deadline:\` trong ACTIVE_LEARNING.md.
3. Today's Dynamic Goal khi Status chưa là Completed và có Deadline.

## Gộp trùng
- Mục dự án hoặc mục tiêu hôm nay trùng khóa và trùng phút hạn với một task thì bị bỏ và task đó ghi "cũng có ở ACTIVE_LEARNING.md:dòng".
- Cùng một task xuất hiện ở danh sách theo dõi và bảng dự án (cùng nội dung sau khi bỏ tiền tố "Tên khóa:", cùng chuỗi Deadline) được gộp thành một; giữ bản của bảng dự án và ghi "(cũng có ở ACTIVE_LEARNING.md:39)". Quyết định phân loại ghi cho id giữ lại loại cả mục đã gộp.

## Báo cáo
Thứ tự: Quá hạn (số mục theo từng bảng, 10 dòng gần hạn nhất; \`detail: true\` xem đủ), Khẩn cấp, Dưới 48 giờ, Dưới 72 giờ, Theo dõi, Đã phân loại, Lệch định dạng, Hạn không thống nhất.

- Lệch định dạng: dòng task chưa tick thiếu Deadline hoặc Priority.
- Hạn không thống nhất: hai dòng cùng khóa, nội dung giống nhau (Jaccard từ khóa từ 0,6) nhưng hạn khác nhau, tối đa 10 cặp.

## Tham số
\`hub?\`, \`now?\` (ISO 8601, để thử), \`detail?\`, \`subject?\` (tên, thư mục hoặc bí danh như GCI, ML, PM). \`--json\` trên CLI trả về \`{now, buckets, triaged, deviations, conflicts, boards}\`.`,

  triage: `# Phân loại việc quá hạn (sirius_triage)

Khi nhiều việc cũ quá hạn (thường vì lộ trình mới thay lộ trình cũ mà chưa đóng task cũ), cảnh báo bị lẫn giữa việc thật và việc đã thay thế. Sirius giúp tách chúng ra mà không sửa bất kỳ tệp nào của người học.

## Ba hành động
- \`suggest\` (chỉ đọc): với mỗi việc quá hạn chưa phân loại, so với task chưa tick, cùng bảng, có hạn muộn hơn.
  - Tách từ khóa (bỏ dấu, bỏ từ dừng). Điểm Jaccard từ 0,2 trở lên, hoặc task mới có chữ "thay" rồi trong 6 từ có từ của việc cũ: gợi ý \`superseded\`.
  - Có tham số \`before\` (YYYY-MM-DD) và hạn cũ hơn mốc đó: \`superseded\` với ghi chú "thuộc kế hoạch trước ...".
  - Quá hạn trên 14 ngày, chưa có task thay thế: \`parked\`.
  - Còn lại: \`active\` ("vẫn còn giá trị: làm ngay hoặc dời hạn trong file").
  Kết quả kết thúc bằng mảng JSON để gọi \`record\` sau khi người học xác nhận.
- \`record\`: \`decisions: [{ id, decision, until?, replacedBy?, note? }]\`. Kiểm tra mọi id có tồn tại (id sai được báo kèm gợi ý gần nhất), \`snoozed\` cần \`until\` từ hôm nay trở đi. Hoặc tất cả được ghi hoặc không gì được ghi.
- \`list\`: quyết định mới nhất cho từng id, kèm các quyết định mồ côi (id không còn khớp dòng nào vì người học đã sửa dòng đó).

## Quyết định
| Quyết định | Tác dụng lên cảnh báo |
|---|---|
| superseded | Loại khỏi cảnh báo (đã có task thay thế) |
| parked | Loại khỏi cảnh báo (tạm gác có chủ đích) |
| snoozed | Loại khỏi cảnh báo cho tới ngày \`until\` |
| active | Không đổi: việc vẫn cần làm |

## Quy tắc bắt buộc
Chỉ ghi các quyết định người học đã xác nhận trong chat. Không tự ghi hàng loạt từ gợi ý.

## Tệp dẫn xuất cho pick_today.py
Sau mỗi \`record\` (và khi \`list\`), Sirius ghi \`<hub>/.sirius/triage.json\`: chỉ những quyết định đang loại task khỏi cảnh báo, kèm \`raw\` (nguyên dòng task) và \`deadlineRaw\` để chương trình Python khớp đúng dòng. Tệp này chỉ chứa ký tự ASCII (tiếng Việt được thoát \\uXXXX).`,

  plan: `# Lộ trình tổng (Roadmaps/MASTER_ROADMAP.md)

Sirius đọc tệp này (không bao giờ sửa) để biết giai đoạn hiện tại, ngân sách giờ, tuần mẫu và mốc từng tuần. Lỗi định dạng không làm công cụ hỏng: phần đọc được vẫn dùng, phần không đọc được thành cảnh báo kèm số dòng.

## Cấu trúc được đọc
- Tiêu đề cấp 1 có ngày YYYY-MM-DD đầu tiên cho năm gốc. Ngày dạng \`12/10\` là ngày/tháng; khoảng có tháng kết thúc nhỏ hơn tháng bắt đầu sang năm sau.
- Mục \`## 3.\` (ngân sách): bảng \`| Giai đoạn | GCI | Machine Learning | ... | Tổng |\`. Dòng \`I. 12/10-25/10 (...)\`, \`III. Từ 21/12 (...)\`. Ô giờ như \`5-6,5 giờ\`, \`2,5-3 giờ\`, \`0\` (dấu phẩy thập phân).
- Mục \`## 4.\` (tuần mẫu): mỗi khối \`**Giai đoạn I (đến 25/10)**\` kèm bảng \`| Ngày | Buổi chính | Buổi phụ |\` với các dòng Thứ Hai đến Chủ Nhật.
- Mục \`## 5.\` (mốc 10 tuần): bảng \`| Tuần | GCI (P0) | Machine Learning | ... |\` với tuần như \`12-18/10\` hoặc \`26/10-01/11\`.

## Cú pháp ô buổi học
- Nhiều buổi trong một ô cách nhau bằng " và ". Tên khóa là phần trước dấu phẩy, dấu hai chấm hoặc dấu ngoặc đầu tiên. Số phút: \`(60 phút)\`, \`(30-60 phút)\` hoặc khung giờ như \`18:00-19:30\`.
- " hoặc " giữa hai khóa: một buổi với các lựa chọn thay thế.
- \`ôn xuyên khóa\`: buổi ôn không thuộc khóa nào. \`Không\`: không có buổi. \`Nghỉ\`: nghỉ. \`Dự phòng\`: khoảng đệm.
- Khóa không nhận ra được: giữ nguyên nhãn, khóa = null, kèm cảnh báo.

## Bí danh khóa
Mỗi khóa nhận tên đầy đủ, tên thư mục (dấu gạch dưới thành khoảng trắng), từ đầu tiên của tên (từ 3 chữ cái), chữ viết tắt (ML, QC, PM) làm bí danh, không phân biệt hoa thường và dấu. Thêm bí danh riêng trong \`<hub>/.sirius/aliases.json\`: \`{"Machine_Learning": ["học máy"]}\`.

## Hàm tra cứu
Giai đoạn theo ngày, kế hoạch theo ngày, ngân sách tuần (giai đoạn chứa thứ Hai), mốc tuần theo ngày.`,

  sessions: `# Cam kết, bấm giờ và ghi phiên

## Cam kết "nếu - thì" (sirius_commit)
\`sirius_commit { subject, time, action, minutes, where?, date? }\` ghi: "Khi 08:00 ở bàn học, mình sẽ mở file X và làm phần Y trong 25 phút." Bước đầu tiên phải cụ thể đến mức bắt đầu được ngay. Tối thiểu 5 phút.

Trạng thái cam kết:
- đúng hẹn: có phiên cùng khóa bắt đầu trong khoảng từ 30 phút trước đến 90 phút sau giờ hẹn.
- trễ: phiên gắn với cam kết (commit_id) nhưng ngoài khoảng, hoặc phiên cùng khóa bắt đầu muộn hơn trong ngày.
- bỏ lỡ: hết ngày mà chưa có phiên nào.
- chưa tới giờ: các trường hợp còn lại.

## Bấm giờ
- \`sirius_start { subject, estimate_minutes, task?, kind?, commit_id? }\`: ghi \`active.json\`. Báo lỗi nếu đang có phiên chạy.
- \`sirius_stop { outcome, note?, minutes? }\`: số phút = giờ dừng trừ giờ bắt đầu (làm tròn, tối thiểu 1). Quá 240 phút mà không ghi đè \`minutes\` thì vẫn ghi nhưng cảnh báo "quên dừng?". Trả về tỉ lệ thực tế / ước lượng và tổng hôm nay.
- \`sirius_log\`: ghi phiên đã học không bấm giờ. Có \`start_time\` thì bắt đầu = date + giờ đó; không có thì kết thúc = bây giờ. Ngày khác hôm nay bắt buộc có \`start_time\`: Sirius không tự đoán giờ.

## Loại phiên (kind)
learn (học), practice (luyện tập), review (ôn tập), homework (bài tập), project (dự án), meta (kế hoạch, tổ chức, làm công cụ MCP, sửa lộ trình). Meta là công việc thật nhưng không phải học nên báo cáo tách riêng.

## Kết quả (outcome)
done, partial, blocked, abandoned.

## Mức tối thiểu hằng ngày
sirius_today hiện "Mức tối thiểu hằng ngày: 25 phút" (đã đạt hay còn bao nhiêu phút) theo số phút không phải meta của ngày. Đổi bằng biến môi trường \`SIRIUS_DAILY_MIN\`.

Mọi dữ liệu chỉ lấy từ đầu vào tường minh của người học; Sirius không suy đoán rồi ghi.`,

  week: `# Tổng kết tuần và thống kê

## sirius_week { week?, write? }
Tuần ISO từ thứ Hai đến Chủ Nhật theo giờ máy. Các mục:
1. Tóm tắt: giờ học so với ngân sách tuần, giờ meta, số ngày có học, cam kết (đúng hẹn, trễ, bỏ lỡ, chưa tới giờ), Năng lực thực tế.
2. Theo khóa: kế hoạch (giờ), thực tế (giờ), số phiên, bằng chứng (gồm hỏi đáp có nguồn và thẻ từ tài liệu của Rigel), hạn trong tuần (xong/tổng), trạng thái: Đúng nhịp, Hụt nhịp, Chưa học, Ngoài kế hoạch.
3. Kế hoạch theo ngày và thực tế.
4. Ước lượng thời gian: trung vị thực tế / ước lượng, cần ít nhất 3 phiên có ước lượng. Ví dụ: "Bạn thường mất 1,6 lần thời gian ước lượng cho Machine Learning: nhân ước lượng với 1,6."
5. Hạn chót: việc có hạn trong tuần, số mục quá hạn chưa phân loại, nguyên tắc 7 (cắt phạm vi) cho khóa trễ hơn 2 tuần.
6. Học và hạ tầng: giờ meta so với giờ học, commit ở thư mục các khóa so với repo công cụ; số hỏi đáp có nguồn, thẻ từ tài liệu và ghi chú đã lưu của Rigel được tính là bằng chứng học.
7. Cho nghi thức Chủ Nhật: Sổ lỗi có mục mới, mốc tuần này và tuần sau, "Chọn 3 việc quan trọng nhất cho tuần tới."
8. Ghi chú nguồn dữ liệu.
9. Bản tóm tắt để chia sẻ: tối đa 5 dòng thuần văn bản, không có đường dẫn tệp, để dán cho bạn học hoặc người hướng dẫn.

\`write: true\` ghi \`Roadmaps/weekly_reviews/<năm>-W<tuần>.md\` (ghi đè tuần đó) rồi báo SmartDrive cập nhật chỉ mục thư mục. Đây là tệp duy nhất Sirius ghi ngoài \`.sirius/\`.

## Năng lực thực tế
Trung vị giờ học mỗi tuần (không tính meta) của tối đa 3 tuần ISO đã kết thúc gần nhất có ghi phiên học. Cần ít nhất 2 tuần, nếu không hiện "Chưa đủ dữ liệu: cần ít nhất 2 tuần có ghi phiên học." Khi giờ tối thiểu của ngân sách tuần lớn hơn 1,5 lần năng lực đo được, Sirius nói thẳng kế hoạch đang gấp bao nhiêu lần và nhắc nguyên tắc 7. Lý do: con người thường lập kế hoạch lạc quan hơn thời gian từng mất thật.

## sirius_stats { weeks? }
Từng tuần (mặc định 4, tối đa 26): phút học theo khóa, phút meta, số ngày học; khi Rigel có hoạt động trong các tuần đó thì thêm bảng "Hỏi đáp có nguồn theo tuần" (số câu hỏi kèm độ phủ mạnh/yếu/không, thẻ từ tài liệu). Chuỗi ngày học cho phép bỏ một ngày lẻ (hai ngày trống liên tiếp làm đứt chuỗi; hôm nay chỉ tính khi đã có phiên đủ 10 phút không phải meta), số ngày học trong 14 ngày qua, trung vị thực tế / ước lượng toàn lịch sử, tỉ lệ giữ cam kết, năng lực thực tế.`,

  evidence: `# Bằng chứng từ hệ sinh thái

Báo cáo tuần đặt giờ ghi trong Sirius cạnh những gì các công cụ khác đã ghi. Sirius chỉ ĐỌC các nguồn này và KHÔNG BAO GIỜ ghi vào chúng.

## Nguồn được đọc
| Nguồn | Tệp | Đọc gì |
|---|---|---|
| Vega | \`<hub>/.vega/cards.json\`, \`<hub>/.vega/reviews.jsonl\` | Thẻ đến hạn (không tạm ngưng, hạn trong ngày), lượt ôn theo khóa trong tuần |
| Orion | \`lab.json\` và \`orion-attempts.jsonl\` của từng bài lab | Số lần chạy, tổng thời gian, đạt hay chưa; lần chạy gần nhất cho "Bước tiếp theo" |
| Aurora | \`progress.jsonl\`, \`aurora-progress-*.jsonl\` | Số sự kiện theo loại (quiz, predict, recall, complete, card) |
| Mira | cùng tệp tiến độ của Aurora | Sự kiện có \`slideId\` bắt đầu bằng \`mira-stop-\`: "Mira dò code a/b đúng" (rating right trên tổng sự kiện predict), tách khỏi số Aurora chung |
| Polaris | \`<thư mục khóa>/polaris/errorlog.md\`, \`reviews.json\`, \`schedule.json\` | Mục Sổ lỗi mới, bước ôn đến hạn và đã làm, có lịch bài học hay không |
| Rigel | \`activity.jsonl\` trong thư mục Rigel | Theo khóa: số lần hỏi đáp có nguồn (\`search_material\`) với độ phủ mạnh/yếu/không, số thẻ đã xuất (\`export_flashcards\`), số ghi chú đã lưu (\`save_note\`) |
| git | \`git log\` của thư mục khóa và các repo công cụ | Số commit trong tuần |

## Cách tìm
- Bài lab Orion và tệp tiến độ Aurora/Mira: hỏi chỉ mục SmartDrive (\`smart-drive search ... --json\`), không bao giờ quét đệ quy ổ D:. Thêm thư mục tường minh bằng \`SIRIUS_EVIDENCE_DIRS\` (ngăn cách bằng dấu chấm phẩy, mỗi thư mục chỉ được liệt kê một cấp).
- Repo công cụ: \`path\` của các máy chủ trong \`%USERPROFILE%/.constellation/ecosystem.json\` cộng \`SIRIUS_TOOLING_DIRS\`.
- Rigel: thư mục lấy từ \`SIRIUS_RIGEL_HOME\`, rồi \`RIGEL_HOME\`, rồi \`%USERPROFILE%/.rigel\`; Sirius mở thẳng \`activity.jsonl\` trong đó, không quét gì thêm.
- \`SIRIUS_SMARTDRIVE=off\` tắt mọi lệnh gọi SmartDrive. Thiếu SmartDrive hoặc git thì nguồn đó bị bỏ qua và được ghi vào "Ghi chú nguồn dữ liệu".

## Rigel (hỏi đáp có nguồn trên tài liệu bài học)
Rigel ghi mỗi lần gọi công cụ thành một dòng JSON trong \`activity.jsonl\`, ví dụ \`{"v":1,"t":"2026-10-13T10:40:00+07:00","tool":"search_material","course":"GCI","lesson":"02_NumPy","subject":"GCI_World_2026_September","coverage":"strong","hits":3}\`.
- Đếm theo khóa trong tuần: câu hỏi = số lần \`search_material\`, kèm độ phủ của tài liệu (\`coverage\`: strong = mạnh, weak = yếu, none = không); thẻ = tổng \`cards\` của \`export_flashcards\`; ghi chú = số lần \`save_note\`. Các công cụ khác (\`read_chunks\`, \`lesson_outline\`, \`sample_material\`, \`scope_for_path\`) không được đếm.
- Gắn khóa: \`subject\` nếu khớp một khóa của hub; không thì \`course\` qua bí danh (GCI, ML, PM, QC, AMD...). Không khớp được thì xếp vào mục "khác" và có một ghi chú trong "Ghi chú nguồn dữ liệu".
- Thiếu tệp thì bỏ qua âm thầm. Chỉ khi \`SIRIUS_RIGEL_HOME\` hoặc \`RIGEL_HOME\` trỏ tới thư mục không tồn tại mới có ghi chú. Dòng hỏng (không phải JSON, thiếu giờ \`t\`, công cụ lạ, phiên bản \`v\` khác 1) bị bỏ qua.
- Báo cáo tuần: cột "Bằng chứng" có \`Hỏi đáp có nguồn N (mạnh a, yếu b, không c)\` và \`Thẻ từ tài liệu M\` (bỏ khi bằng 0); mục "Học và hạ tầng" tính chúng là bằng chứng học, kèm số ghi chú đã lưu. \`sirius_stats\` có bảng số câu hỏi theo tuần khi có hoạt động.
- Riêng tư: Sirius chỉ ĐỌC \`activity.jsonl\` và chỉ đếm. Sirius không ghi gì vào thư mục Rigel, không chép chữ nào từ tệp này vào journal, bản tổng kết hay kết quả công cụ, và không bao giờ ghi lại nội dung câu hỏi.

## Chuỗi bằng chứng gọn
Ví dụ: \`Orion 3 lần chạy, Vega 12 lượt ôn, Aurora 5 sự kiện, Mira dò code 3/4 đúng, Hỏi đáp có nguồn 6 (mạnh 4, yếu 1, không 1), Thẻ từ tài liệu 5, Sổ lỗi 2, commit 4\` (số 0 được bỏ).

## Giới hạn
Mọi bộ đọc đều giới hạn kích thước và thời gian (git tối đa 15 giây mỗi lệnh; \`activity.jsonl\` chỉ đọc tối đa 4 MB cuối). Lỗi một nguồn không làm hỏng báo cáo.`,

  rules: `# Quy tắc của Sirius

1. Chỉ đọc tệp của người học: không sửa, tick hay xóa TASKS.md, ACTIVE_LEARNING.md, INDEX.md, lộ trình. Trạng thái của Sirius nằm trong \`<hub>/.sirius/\`. Ngoại lệ duy nhất ngoài thư mục đó: tệp tổng kết tuần khi \`sirius_week { write: true }\`.
2. Chỉ ghi những gì người học đã làm hoặc đã quyết định. Không suy đoán rồi tự ghi. Quyết định phân loại phải được xác nhận trong chat.
3. Không quét đệ quy ổ D: (exFAT, cụm 512 KB). Mở tệp theo đường dẫn chính xác; tìm bài lab và tệp tiến độ qua chỉ mục SmartDrive hoặc \`SIRIUS_EVIDENCE_DIRS\`.
4. Văn bản dành cho người học bằng tiếng Việt có dấu; mã, khóa JSON, tên công cụ bằng tiếng Anh. Không dùng emoji.
5. Dữ liệu cá nhân trong \`<hub>/.sirius/\` ở lại máy và không đưa lên git. Trước mỗi lần ghi vào thư mục này (journal, active.json, triage.json), Sirius bảo đảm có \`<hub>/.sirius/.gitignore\` gồm đúng hai dòng \`# Created by Sirius: personal study data, never commit.\` và \`*\` (tạo nếu thiếu, không bao giờ ghi đè). Nhờ vậy journal không vào git ngay cả khi \`.gitignore\` gốc của hub chưa liệt kê \`.sirius/\`.
6. Không bao giờ chạy npm install trong thư mục dự án; chỉ build bằng \`node scripts/build.mjs\` với toolchain ngoài.

## Biến môi trường
| Biến | Ý nghĩa |
|---|---|
| SIRIUS_HUB, POLARIS_HUB | Thư mục hub (mặc định D:/02_Learning_Knowledge) |
| SIRIUS_NOW | Giờ giả lập ISO 8601 (để kiểm thử) |
| SIRIUS_SMARTDRIVE | off, false, 0 hoặc no để tắt SmartDrive; SIRIUS_SMARTDRIVE_CMD để đổi lệnh |
| SIRIUS_EVIDENCE_DIRS | Thư mục bổ sung chứa lab Orion và tệp tiến độ (dấu ; ngăn cách) |
| SIRIUS_TOOLING_DIRS | Repo công cụ bổ sung cho thống kê commit (dấu ; ngăn cách) |
| SIRIUS_RIGEL_HOME, RIGEL_HOME | Thư mục Rigel chứa \`activity.jsonl\` (thử theo thứ tự này, rồi \`%USERPROFILE%/.rigel\`); chỉ đọc |
| SIRIUS_DAILY_MIN | Mức tối thiểu hằng ngày, mặc định 25 phút |
| SIRIUS_TOOLCHAIN | Toolchain build (rồi ORION_TOOLCHAIN, VEGA_TOOLCHAIN, POLARIS_TOOLCHAIN) |`,
};

export function getGuideTopic(topic?: string): string {
  if (!topic || !topic.trim()) {
    return `# Hướng dẫn sử dụng Sirius MCP (Sirius Guide)

Chọn một chủ đề để xem chi tiết:
- \`overview\`: Sirius là gì, 10 công cụ, quy trình một ngày.
- \`deadlines\`: Quy tắc hạn chót, nguồn các mục, gộp trùng, báo cáo.
- \`triage\`: Phân loại việc quá hạn, quyết định, tệp triage.json.
- \`plan\`: Cách đọc Roadmaps/MASTER_ROADMAP.md và bí danh khóa.
- \`sessions\`: Cam kết, bấm giờ, ghi phiên, trạng thái cam kết.
- \`week\`: Tổng kết tuần, năng lực thực tế, thống kê, chuỗi ngày học.
- \`evidence\`: Nguồn bằng chứng từ Vega, Orion, Aurora, Mira, Polaris, Rigel, git.
- \`rules\`: Quy tắc bắt buộc và biến môi trường.

*Ví dụ CLI:* \`node dist/sirius.mjs guide deadlines\`
*Ví dụ MCP:* \`sirius_guide { topic: "deadlines" }\``;
  }

  const t = topic.trim().toLowerCase() as GuideTopic;
  const doc = GUIDE_DOCS[t];
  if (doc) return doc;

  return `Chủ đề '${topic}' không tồn tại. Các chủ đề khả dụng: ${GUIDE_TOPICS.join(", ")}`;
}
