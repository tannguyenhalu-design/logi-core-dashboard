/**
 * pages/api/auth/[...nextauth].js
 * Google OAuth via NextAuth — chỉ cho phép @ghn.vn
 */
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  callbacks: {
    // Chặn ngay khi sign-in nếu email không phải @ghn.vn
    async signIn({ account, profile }) {
      if (account.provider === "google") {
        return profile.email?.endsWith("@ghn.vn") === true;
      }
      return false;
    },

    // Gắn email vào JWT token
    async jwt({ token, profile }) {
      if (profile) {
        token.email = profile.email;
        token.name  = profile.name;
      }
      return token;
    },

    // Truyền email + role vào session
    async session({ session, token }) {
      session.user.email = token.email;
      session.user.name  = token.name;
      session.user.role  = "manager"; // Tất cả @ghn.vn đều là manager
      return session;
    },
  },

  pages: {
    signIn:  "/login",
    error:   "/login", // Redirect về login khi bị từ chối
  },

  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
