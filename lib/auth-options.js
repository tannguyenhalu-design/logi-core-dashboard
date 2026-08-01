/**
 * lib/auth-options.js
 * Tách authOptions ra file riêng (không có ký tự đặc biệt trong tên)
 * để import an toàn từ các API routes khác.
 */
import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  callbacks: {
    async signIn({ account, profile }) {
      if (account.provider === "google") {
        return true;
      }
      return false;
    },

    async jwt({ token, profile }) {
      if (profile) {
        token.email = profile.email;
        token.name  = profile.name;
      }
      return token;
    },

    async session({ session, token }) {
      session.user.email = token.email;
      session.user.name  = token.name;
      session.user.role  = "manager";
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error:  "/login",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
