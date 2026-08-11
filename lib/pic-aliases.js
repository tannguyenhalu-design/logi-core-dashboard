/**
 * lib/pic-aliases.js
 * The "Data dự án" and Tasks sheets tag work using a small set of
 * long-standing "work key" emails (picked when those sheets were first
 * set up), some of which differ from the employee's real GHN SSO login
 * email — different local part and/or domain (e.g. "tutd@ghn.vn" vs the
 * real "tutd@giaohangnhanh.vn"). Session identity (session.user.email)
 * always comes from the real SSO email, so "is this project/task mine"
 * checks need to reconcile the two or they silently match nothing.
 */
const EMAIL_ALIASES = {
  "tutd@ghn.vn": "tutd@giaohangnhanh.vn", // Tống Duy Tú, 3131671
  "datnt2@ghn.vn": "datnt464@giaohangnhanh.vn", // Nguyễn Thành Đạt, 3163562
  // diennk@giaohangnhanh.vn already matches Nguyễn Kim Diện's real email (3164855)
};

export function emailsMatch(a, b) {
  const na = String(a || "").trim().toLowerCase();
  const nb = String(b || "").trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  return (EMAIL_ALIASES[na] || na) === (EMAIL_ALIASES[nb] || nb);
}
