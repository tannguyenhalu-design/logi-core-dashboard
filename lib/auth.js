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

/**
 * Parse USERS_JSON environment variable.
 * Format: [{"username":"admin","password":"xxx","role":"manager","project":null},...]
 * role: "manager" = see all | "client" = see only assigned project
 */
export function getUsers() {
  try {
    return JSON.parse(process.env.USERS_JSON || "[]");
  } catch {
    return [];
  }
}

export function authenticate(username, password) {
  const users = getUsers();
  const user = users.find(
    (u) => u.username === username && u.password === password
  );
  return user || null;
}
