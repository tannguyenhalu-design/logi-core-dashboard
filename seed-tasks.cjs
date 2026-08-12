const { google } = require('googleapis');
const fs = require('fs');

async function seed() {
  const key = JSON.parse(fs.readFileSync('C:\\Users\\TanNguyen\\Downloads\\sd3-dienmay-app-key.json', 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = '19IrefOKKtejbQOKhJ1SM1mi2p5yKOMXwdt9OyKsZDVA';

  const rows = [
    [
      "task_001",
      "Review SLA & Tỷ lệ Ontime dự án LG Electronics South",
      "datnt2@ghn.vn",
      "Nguyễn Thành Đạt",
      "LG Electronics South",
      "2026-08-15T17:00:00.000Z",
      "in_progress",
      "Rà soát tỷ lệ giao đúng giờ và khắc phục điểm nghẽn đơn cận tỉnh.",
      new Date().toISOString(),
      "System Setup",
      new Date().toISOString(),
      "System Setup",
      "",
      "",
      "grp_001",
      ""
    ],
    [
      "task_002",
      "Kiểm tra quy trình đóng gói chống bể vỡ tuyến Kho Củ Chi - Kho Nền Trắng",
      "tutd@ghn.vn",
      "Duy Tú",
      "Aqua B2C",
      "2026-08-14T12:00:00.000Z",
      "in_progress",
      "Yêu cầu kho bọc màng xốp và gia cố đệm gỗ chống va đập.",
      new Date().toISOString(),
      "System Setup",
      new Date().toISOString(),
      "System Setup",
      "",
      "",
      "grp_002",
      ""
    ],
    [
      "task_003",
      "Rà soát đền bù hư hỏng dự án Casper B2B",
      "diennk@giaohangnhanh.vn",
      "Kim Diện",
      "Casper",
      "2026-08-16T17:00:00.000Z",
      "in_progress",
      "Đối chiếu hồ sơ đền bù Rillnet tháng 7.",
      new Date().toISOString(),
      "System Setup",
      new Date().toISOString(),
      "System Setup",
      "",
      "",
      "grp_003",
      ""
    ],
    [
      "task_004",
      "Tối ưu kế hoạch tách chuyến xe 5T cho đơn hàng cận tỉnh HCM",
      "datnt2@ghn.vn",
      "Nguyễn Thành Đạt",
      "Samsung SDS Đà Nẵng",
      "2026-08-13T17:00:00.000Z",
      "in_progress",
      "Đảm bảo tải trọng trên 70% (tương đương >3.500kg) trước khi cho xe xuất kho.",
      new Date().toISOString(),
      "System Setup",
      new Date().toISOString(),
      "System Setup",
      "",
      "",
      "grp_004",
      ""
    ],
    [
      "task_005",
      "Họp Kickoff & Thỏa thuận Volume dự án Hồng Đạt MXT",
      "diennk@giaohangnhanh.vn",
      "Kim Diện",
      "Hồng Đạt MXT",
      "2026-08-18T10:00:00.000Z",
      "in_progress",
      "Thống nhất quy trình kiểm đếm hàng điện máy giao kho tổng.",
      new Date().toISOString(),
      "System Setup",
      new Date().toISOString(),
      "System Setup",
      "",
      "",
      "grp_005",
      ""
    ]
  ];

  console.log("Appending initial SD3 tasks into Tasks tab...");
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Tasks!A2:P',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  console.log("Successfully appended tasks!", res.status);
}

seed().catch(console.error);
