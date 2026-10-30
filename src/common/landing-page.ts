// src/common/landing-page.ts
/** Minimal HTML escape for user content interpolated into the page. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The page shell shared by the public invite landing pages (`/g/:code`,
 * `/t/:code`). Self-contained inline CSS — this is served by the API with
 * no static assets, and it must render fine in the throwaway browser tab a
 * camera scan opens.
 */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
         sans-serif; margin: 0; padding: 24px; display: flex;
         justify-content: center; background: #f4f5f7; color: #1a1c1f; }
  main { max-width: 420px; width: 100%; background: #fff; border-radius: 16px;
         padding: 32px 28px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
         text-align: center; }
  .logo { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; }
  h1 { font-size: 1.4rem; margin: 12px 0 4px; }
  .desc { color: #5c6470; margin-top: 0; }
  ol { text-align: left; margin: 16px auto; padding-left: 24px; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 1.05rem; background: #f0f2f5; border-radius: 8px;
          padding: 12px; word-break: break-all; user-select: all; }
  .open { display: block; margin: 20px auto 4px; padding: 14px 20px;
          background: #16a34a; color: #fff; border-radius: 10px;
          font-weight: 600; text-decoration: none; }
  .fine { color: #8a919c; font-size: .85rem; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
