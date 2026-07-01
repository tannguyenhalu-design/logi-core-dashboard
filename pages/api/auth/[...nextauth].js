/**
 * pages/api/auth/[...nextauth].js
 * Import authOptions từ lib/auth-options.js để tránh lỗi circular import
 */
import NextAuth from "next-auth";
import { authOptions } from "../../../lib/auth-options";

export default NextAuth(authOptions);
