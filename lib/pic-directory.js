// Canonical PIC directory — single source of truth for staff email <-> display name.
// Shared by the manual task UI (components/operations/utils.js) and the AI
// chat's task-creation tool (lib/ai-agent-tools.js) so both resolve the same
// person the same way instead of each guessing independently.
export const PIC_NAMES = {
  "tutd@ghn.vn": "Duy Tú",
  "diennk@giaohangnhanh.vn": "Kim Diện",
  "datnt2@ghn.vn": "Nguyễn Thành Đạt",
  "vidt4@giaohangnhanh.vn": "Thúy Vi",
};

// Some Users-sheet "PIC Name" entries are typed as a shorter form than the
// canonical PIC_NAMES value (e.g. "Thành Đạt" instead of "Nguyễn Thành
// Đạt") — this maps known short-form aliases to the same canonical name so
// resolvePicName() still lines them up with the project-side value.
const NAME_ALIASES = {
  "Thành Đạt": "Nguyễn Thành Đạt",
};

// Projects tag their PIC by email ("diennk@giaohangnhanh.vn"), but a user
// account's own "pic" field comes from the Users sheet's "PIC Name" column
// — which, true to its name, is often filled in with a display name
// ("Kim Diện") instead of the email. Comparing those two forms directly
// for identity (picFilter, isAssignedPic, ...) silently matches nothing
// even when they refer to the same person — this resolves either form to
// the display name so both sides compare on the same footing. Values that
// aren't a known email or alias (i.e. already the canonical name) pass
// through unchanged.
export function resolvePicName(pic) {
  if (!pic) return pic;
  return PIC_NAMES[pic] || NAME_ALIASES[pic] || pic;
}

function stripAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

// Resolves a free-text name (as extracted from natural-language chat, which
// may be a first name, a nickname, or a full name with different accents)
// to a real staff {email, name} from PIC_NAMES. Returns null if nothing
// matches with reasonable confidence — callers must NOT fabricate an email
// from the raw name in that case (that produced silently-wrong assignees,
// e.g. "Đạt" -> invented "dat@ghn.vn" instead of the real "datnt2@ghn.vn").
export function findPic(rawName) {
  if (!rawName) return null;
  if (rawName.includes("@")) {
    const email = rawName.trim().toLowerCase();
    return PIC_NAMES[email] ? { email, name: PIC_NAMES[email] } : null;
  }
  const clean = stripAccents(rawName);
  if (!clean) return null;

  const entries = Object.entries(PIC_NAMES);
  // 1. Exact full-name match (accent-insensitive)
  for (const [email, name] of entries) {
    if (stripAccents(name) === clean) return { email, name };
  }
  // 2. Alias match
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    if (stripAccents(alias) === clean) {
      const email = entries.find(([, n]) => n === canonical)?.[0];
      if (email) return { email, name: canonical };
    }
  }
  // 3. Partial match — name contains the given word, or vice versa (e.g. "Đạt" -> "Nguyễn Thành Đạt")
  const candidates = entries.filter(
    ([, name]) => stripAccents(name).includes(clean) || clean.includes(stripAccents(name))
  );
  if (candidates.length === 1) {
    const [email, name] = candidates[0];
    return { email, name };
  }
  return null;
}
