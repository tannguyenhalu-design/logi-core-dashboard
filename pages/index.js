/**
 * pages/index.js — Redirect to dashboard or login
 */
export async function getServerSideProps({ req, res }) {
  const { getSession } = await import("../lib/auth");
  const session = await getSession(req, res);
  if (session?.user) {
    return { redirect: { destination: "/dashboard", permanent: false } };
  }
  return { redirect: { destination: "/login", permanent: false } };
}

export default function Index() {
  return null;
}
