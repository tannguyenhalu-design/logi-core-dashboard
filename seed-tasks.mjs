import { createTasks } from "./lib/tasks.js";

async function seed() {
  const initialTasks = [
    {
      title: "Review SLA & Tỷ lệ Ontime dự án LG Electronics South",
      pic: "datnt2@ghn.vn",
      picName: "Nguyễn Thành Đạt",
      project: "LG Electronics South",
      deadline: "2026-08-15T17:00:00.000Z",
      notes: "Rà soát tỷ lệ giao đúng giờ và khắc phục điểm nghẽn đơn cận tỉnh.",
    },
    {
      title: "Kiểm tra quy trình đóng gói chống bể vỡ tuyến Kho Củ Chi - Kho Nền Trắng",
      pic: "tutd@ghn.vn",
      picName: "Duy Tú",
      project: "Aqua B2C",
      deadline: "2026-08-14T12:00:00.000Z",
      notes: "Yêu cầu kho bọc màng xốp và gia cố đệm gỗ chống va đập.",
    },
    {
      title: "Rà soát đền bù hư hỏng dự án Casper B2B",
      pic: "diennk@giaohangnhanh.vn",
      picName: "Kim Diện",
      project: "Casper",
      deadline: "2026-08-16T17:00:00.000Z",
      notes: "Đối chiếu hồ sơ đền bù Rillnet tháng 7.",
    },
    {
      title: "Tối ưu kế hoạch tách chuyến xe 5T cho đơn hàng cận tỉnh HCM",
      pic: "datnt2@ghn.vn",
      picName: "Nguyễn Thành Đạt",
      project: "Samsung SDS Đà Nẵng",
      deadline: "2026-08-13T17:00:00.000Z",
      notes: "Đảm bảo tải trọng trên 70% (tương đương >3.500kg) trước khi cho xe xuất kho.",
    },
    {
      title: "Họp Kickoff & Thỏa thuận Volume dự án Hồng Đạt MXT",
      pic: "diennk@giaohangnhanh.vn",
      picName: "Kim Diện",
      project: "Hồng Đạt MXT",
      deadline: "2026-08-18T10:00:00.000Z",
      notes: "Thống nhất quy trình kiểm đếm hàng điện máy giao kho tổng.",
    },
  ];

  console.log("Seeding initial SD3 tasks into Master Sheet...");
  const res = await createTasks(initialTasks, "System Setup");
  console.log("Successfully created tasks count:", res.length);
}

seed().catch(console.error);
