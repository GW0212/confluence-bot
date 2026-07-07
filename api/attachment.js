export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url: fileUrl, email, token, filename } = req.query;
  if (!fileUrl || !email || !token) return res.status(400).send('필수 파라미터 누락');

  try {
    const auth = Buffer.from(
      `${decodeURIComponent(email)}:${decodeURIComponent(token)}`
    ).toString('base64');

    const response = await fetch(decodeURIComponent(fileUrl), {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    if (!response.ok) return res.status(response.status).send('파일 로드 실패');

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const fname = filename ? decodeURIComponent(filename) : 'download';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
    const cl = response.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    res.setHeader('Cache-Control', 'no-store');

    // 스트리밍으로 전달 (4.5MB 버퍼 제한 우회)
    const reader = response.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();
  } catch (e) {
    if (!res.headersSent) res.status(500).send(e.message);
  }
}
