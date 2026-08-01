/**
 * lib/auth.js
 * iron-session authentication helpers
 */
import { getIronSession } from "iron-session";

export const sessionOptions = {
  password: process.env.SESSION_SECRET || "complex-password-at-least-32-chars-long-here",
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
