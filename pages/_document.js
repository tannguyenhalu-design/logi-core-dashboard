import { Html, Head, Main, NextScript } from "next/document";

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var theme = window.localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
