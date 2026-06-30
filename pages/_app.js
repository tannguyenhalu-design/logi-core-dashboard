/**
 * pages/_app.js — Load global CSS
 */
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
