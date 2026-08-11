import { resolveSSOUser } from "../../lib/users";
export default async function handler(req, res) {
  try {
    const user = await resolveSSOUser({ employeeId: 'test', name: 'Test', email: 'test@ghn.vn' });
    res.status(200).json({ ok: true, user });
  } catch(e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
