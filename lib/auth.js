/**
 * lib/auth.js
 * iron-session authentication helpers
 */
import { getIronSession } from "iron-session";

if (!process.env.SESSION_SECRET) {
  throw new Error("Missing SESSION_SECRET env var");
}

export const sessionOptions = {
  password: process.env.SESSION_SECRET,
  cookieName: "logi_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  },
};

export async function getSession(req, res) {
  return await getIronSession(req, res, sessionOptions);
}
